import type { CacheEntry, Wllama, WllamaLogger } from '@wllama/wllama/esm/index.js';
import { defaultWllamaAssets } from '../assets/browser';
import { loadWllama } from './loader';
import { cpuContextWindow, mobileCpuContextWindow, mobileDevice } from '../models';
import {
    hasAudio,
    hasImages,
    modelUrl,
    replyOptions,
    runEngineChat,
} from './engine';
import { createModelStore, isStoreError } from './store';
import { contentBuffer } from './images';
import { LlmBackend, LlmPhase } from '../enums';
import type {
    ChatModel,
    EngineChatParams,
    EngineMessage,
    LlmEngine,
    LlmRuntime,
    StartLlmParams,
    WllamaAssets,
    WllamaContentPart,
    WllamaMessage,
} from '../types';

const
    /** Native log emitted when the CPU engine probes for a GPU adapter it never uses */
    gpuProbeLog = `ggml_webgpu: Failed to get an adapter`,
    /** Resumable file store of the CPU engine */
    store = createModelStore(`wllama-store`);

/** CPU threads after the hardware maximum and the caller cap */
const cpuThreads = (cores: number, maxThreads: number): number =>
    Math.max(1, Math.min(
        Math.max(2, Math.min(8, (cores || 4) - 1)),
        2, //  maxThreads,
    ));

let
    wllama: Wllama | undefined,
    assets: WllamaAssets | undefined,
    assetsKey = ``,
    /** Whether the current call wants engine logs */
    loggingOn = false;

const
    /** Stable key of one asset set */
    assetsKeyOf = (value: WllamaAssets): string =>
        `${value.wasm}|${value.compatWasm}|${value.compatWorker}`,
    /** Merge asset overrides over the auto-resolved defaults */
    resolveAssets = (overrides?: Partial<WllamaAssets>): WllamaAssets => {
        const defaults = defaultWllamaAssets();
        return {
            wasm: overrides?.wasm || defaults.wasm,
            compatWasm: overrides?.compatWasm || defaults.compatWasm,
            compatWorker: overrides?.compatWorker || defaults.compatWorker,
        };
    },
    /** wllama logger that follows the per-call logging flag */
    cpuLogger = (base: WllamaLogger): WllamaLogger => {
        // the compat build forwards native logs at every level
        const quiet = (write: (...args: unknown[]) => void) =>
            (...args: unknown[]) => {
                if (!loggingOn) return;
                if (typeof args[0] == `string` && args[0].includes(gpuProbeLog))
                    return;
                write(...args);
            };
        return {
            ...base,
            log: quiet(base.log),
            warn: quiet(base.warn),
            error: quiet(base.error),
        };
    },
    /** Lazily create the single wllama instance */
    getWllama = async (): Promise<Wllama> => {
        if (wllama) return wllama;
        const
            mod = await loadWllama(),
            current = assets || resolveAssets(),
            instance = new mod.Wllama(
                { default: current.wasm },
                { logger: cpuLogger(mod.LoggerWithoutDebug) },
            );
        if (!assets) {
            assets = current;
            assetsKey = assetsKeyOf(current);
        };
        instance.setCompat({
            wasm: current.compatWasm,
            worker: current.compatWorker,
        });
        wllama = instance;
        return instance;
    },
    /** Drop the worker, a crashed or exited one cannot be reused */
    dropWllama = async () => {
        const instance = wllama;
        wllama = undefined;
        try { await instance?.exit(); } catch { };
    },
    /** Whether a cache entry holds the requested file */
    entryOf = (entry: CacheEntry, file: string): boolean =>
        entry.name.includes(file)
        || !!entry.metadata?.originalURL?.includes(file),
    /** Every CPU file of one model, its name and remote URL */
    cpuFiles = (model: ChatModel): Array<{ name: string, url: string }> => {
        const cpu = model.cpu;
        if (!cpu) return [];
        return [
            { name: cpu.file, url: modelUrl(cpu.repo, cpu.file) },
            ...(cpu.mmproj
                ? [{
                    name: cpu.mmproj.file,
                    url: modelUrl(cpu.repo, cpu.mmproj.file),
                }]
                : []),
        ];
    },
    /** Whether every CPU file is complete in the resumable store */
    filesStored = async (model: ChatModel): Promise<boolean> => {
        const files = cpuFiles(model);
        if (!files.length) return false;
        for (const file of files) {
            const stored = await store.stored(file.url);
            if (!stored?.complete) return false;
        };
        return true;
    },
    /** Whether every CPU file is complete in the wllama cache manager */
    filesCached = async (
        instance: Wllama,
        model: ChatModel,
    ): Promise<boolean> => {
        const entries = await instance.cacheManager.list();
        return cpuFiles(model).every(file =>
            entries.some(entry => entryOf(entry, file.name)));
    },
    /** Every CPU file as a Blob, from the store or a resumable download */
    storedBlobs = async ({
        model,
        signal,
        onProgress,
    }: {
        model: ChatModel,
        signal?: AbortSignal,
        onProgress: StartLlmParams[`onProgress`],
    }): Promise<Blob[] | undefined> => {
        const
            files = cpuFiles(model),
            blobs: Blob[] = [];
        for (let index = 0; index < files.length; index++) {
            if (signal?.aborted) throw new Error(`Cancelled`);
            const saved = await store.download({
                url: files[index].url,
                signal,
                onProgress: (progress, phase) =>
                    onProgress((index + progress) / files.length, phase),
            });
            // a host without a file system streams the files instead
            if (!saved) return undefined;
            blobs.push(saved.file);
        };
        return blobs.length ? blobs : undefined;
    },
    /** Map built messages to wllama turns */
    toWllamaMessages = async (
        messages: EngineMessage[],
    ): Promise<WllamaMessage[]> => {
        const result: WllamaMessage[] = [];
        for (const message of messages) {
            if (typeof message.content == `string`) {
                if (message.role == `system`)
                    result.push({ role: `system`, content: message.content });
                else if (message.role == `assistant`)
                    result.push({ role: `assistant`, content: message.content });
                else result.push({ role: `user`, content: message.content });
                continue;
            };
            const parts: WllamaContentPart[] = [];
            for (const part of message.content) {
                if (part.type == `text`)
                    parts.push({ type: `text`, text: part.text });
                else parts.push({
                    type: part.type,
                    data: await contentBuffer(part.url),
                });
            };
            result.push({ role: `user`, content: parts });
        };
        return result;
    },
    /** Stream one reply on a started CPU runtime */
    chatOn = async (
        instance: Wllama,
        model: ChatModel,
        params: EngineChatParams,
    ): Promise<string | undefined> => {
        loggingOn = params.logging === true;
        if (!instance.isModelLoaded()) return undefined;
        return await runEngineChat({
            model,
            params,
            stopped: () => !!params.signal?.aborted,
            start: async messages => {
                if (hasImages(messages) && !instance.supportInputModality(`image`))
                    throw new Error(`Model does not accept images`);
                if (hasAudio(messages) && !instance.supportInputModality(`audio`))
                    throw new Error(`Model does not accept audio`);
                return await instance.createChatCompletion({
                    messages: await toWllamaMessages(messages),
                    ...replyOptions(params.limits, params.reasoning),
                    abortSignal: params.signal,
                    ...(model.reasoning
                        ? { chat_template_kwargs: { enable_thinking: params.reasoning } }
                        : {}),
                });
            },
        });
    },
    /** Start the CPU runtime, the unified engine entry */
    startLLM = async ({
        model,
        limits,
        onProgress,
        signal,
        logging,
        assets: overrides,
    }: StartLlmParams): Promise<LlmRuntime> => {
        loggingOn = logging === true;
        const
            /** Context window for this device, a phone keeps a smaller cache */
            contextSize = mobileDevice() ? mobileCpuContextWindow : cpuContextWindow,
            cpu = model.cpu;
        if (!cpu) throw new Error(`Model has no CPU artifact`);
        const
            next = resolveAssets(overrides),
            key = assetsKeyOf(next);
        // a different asset set needs a fresh worker
        if (wllama && key != assetsKey) await dropWllama();
        assets = next;
        assetsKey = key;
        const threads = cpuThreads(
            (typeof navigator != `undefined` && navigator.hardwareConcurrency) || 4,
            limits.maxThreads,
        );
        const
            instance = await getWllama(),
            complete = await filesStored(model),
            projectorFile = cpu.mmproj?.file,
            modelFileUrl = modelUrl(cpu.repo, cpu.file),
            projectorUrl = projectorFile
                ? modelUrl(cpu.repo, projectorFile) : ``;
        if (signal?.aborted) {
            await dropWllama();
            throw new Error(`Cancelled`);
        };
        // an older text-only cache cannot accept the projector
        if (!complete && projectorFile) {
            const
                entries = await instance.cacheManager.list(),
                hasModel = entries.some(entry => entryOf(entry, cpu.file)),
                hasProjector = entries.some(entry => entryOf(entry, projectorFile));
            if (hasModel && !hasProjector)
                await instance.cacheManager.deleteMany(entry =>
                    entryOf(entry, cpu.file));
        };
        const loadParams = {
            n_ctx: contextSize,
            n_threads: threads,
            // cap chain-of-thought tokens, long thinking makes replies slow
            reasoning_budget_tokens: limits.maxThinkingTokens,
            // this engine is the CPU fallback, never offload to a GPU
            n_gpu_layers: 0,
            jinja: true,
        };
        try {
            // a complete store or an older cache skips the network
            let blobs = complete
                ? await storedBlobs({ model, signal, onProgress })
                : undefined;
            if (!blobs && !complete && !await filesCached(instance, model)
                .catch(() => false))
                blobs = await storedBlobs({ model, signal, onProgress })
                    .catch(error => {
                        if (signal?.aborted) throw new Error(`Cancelled`);
                        // a store the browser cannot write still streams the file
                        if (!isStoreError(error)) throw error;
                        if (logging) console.log(`Local model store failed`, error);
                        return undefined;
                    });
            if (blobs) {
                onProgress(1, LlmPhase.load);
                await instance.loadModel(blobs, loadParams);
            } else {
                await instance.loadModelFromUrl(
                    projectorUrl
                        ? { url: modelFileUrl, mmprojUrl: projectorUrl }
                        : modelFileUrl,
                    {
                        ...loadParams,
                        useCache: true,
                        // abort the in-flight model download when cancelled
                        signal,
                        progressCallback: ({ loaded, total }) => {
                            const progress = total ? loaded / total : 0;
                            // the final progress means the download is done and loading begins
                            onProgress(
                                progress,
                                progress >= 1 ? LlmPhase.load : LlmPhase.download,
                            );
                        },
                    },
                );
            };
        } catch (error) {
            // a failed download can leave the worker unusable
            await dropWllama();
            throw error;
        };
        if (signal?.aborted) {
            await dropWllama();
            throw new Error(`Cancelled`);
        };
        // a failed context init is still reported as loaded, the first chat
        // call would abort the wasm module
        if (!instance.getLoadedContextInfo().n_ctx) {
            await dropWllama();
            throw new Error(`Failed to create model context`);
        };
        return {
            model,
            backend: LlmBackend.cpu,
            contextSize,
            chat: params => chatOn(instance, model, params),
            unload: async () => {
                if (wllama == instance) await dropWllama();
                else try { await instance.exit(); } catch { };
            },
        };
    },
    wllamaEngine: LlmEngine = {
        backend: LlmBackend.cpu,
        startLLM,
        cached: async (model) => {
            try {
                if (!model.cpu) return false;
                if (await filesStored(model)) return true;
                return await filesCached(await getWllama(), model);
            } catch { return false; };
        },
        purge: async () => {
            try { await store.purge(); } catch { };
            try {
                const instance = await getWllama();
                await instance.cacheManager.clear();
            } catch { };
        },
    };

export {
    cpuFiles,
    cpuThreads,
    startLLM,
    storedBlobs,
    toWllamaMessages,
    wllamaEngine,
};
