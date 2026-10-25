import type { CacheEntry, Wllama, WllamaLogger } from '@wllama/wllama/esm/index.js';
import { defaultWllamaAssets } from '../assets/browser';
import { loadWllama } from './loader';
import { cpuContextWindow } from '../models';
import {
    replyOptions,
    runEngineChat,
} from './engine';
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
    /** Context window requested from the CPU engine, the wasm heap holds weights and cache */
    contextSize = cpuContextWindow,
    /** Model host */
    hfBase = `https://huggingface.co`,
    /** Native log emitted when the CPU engine probes for a GPU adapter it never uses */
    gpuProbeLog = `ggml_webgpu: Failed to get an adapter`;

/** CPU threads after the hardware maximum and the caller cap */
const cpuThreads = (cores: number, maxThreads: number): number =>
    Math.max(1, Math.min(
        Math.max(2, Math.min(8, (cores || 4) - 1)),
        maxThreads,
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
    /** Every cached file of one model */
    modelFiles = (model: ChatModel): string[] =>
        [model.cpu.file, ...(model.cpu.mmproj ? [model.cpu.mmproj.file] : [])],
    /** Resolve one model file on the model host */
    modelUrl = (repo: string, file: string): string =>
        `${hfBase}/${repo}/resolve/main/${file}`,
    /** Decode an image URL into bytes for wllama */
    imageBuffer = async (url: string): Promise<ArrayBuffer> => {
        if (!url.startsWith(`data:`))
            return await (await fetch(url)).arrayBuffer();
        const
            comma = url.indexOf(`,`),
            head = comma >= 0 ? url.slice(0, comma) : ``;
        if (comma < 0) throw new Error(`Invalid image data`);
        if (!head.includes(`;base64`))
            return await (await fetch(url)).arrayBuffer();
        const
            binary = atob(url.slice(comma + 1)),
            bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
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
            for (const part of message.content)
                parts.push(part.type == `text`
                    ? { type: `text`, text: part.text }
                    : { type: `image`, data: await imageBuffer(part.url) });
            result.push({ role: `user`, content: parts });
        };
        return result;
    },
    /** Whether any turn carries an image */
    hasImages = (messages: EngineMessage[]): boolean =>
        messages.some(message =>
            Array.isArray(message.content)
            && message.content.some(part => part.type == `image`)),
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
            modelFileUrl = modelUrl(model.cpu.repo, model.cpu.file),
            projectorFile = model.cpu.mmproj?.file,
            projectorUrl = projectorFile
                ? modelUrl(model.cpu.repo, projectorFile) : ``;
        if (signal?.aborted) {
            await dropWllama();
            throw new Error(`Cancelled`);
        };
        // an older text-only cache cannot accept the projector
        if (projectorFile) {
            const
                entries = await instance.cacheManager.list(),
                hasModel = entries.some(entry => entryOf(entry, model.cpu.file)),
                hasProjector = entries.some(entry => entryOf(entry, projectorFile));
            if (hasModel && !hasProjector)
                await instance.cacheManager.deleteMany(entry =>
                    entryOf(entry, model.cpu.file));
        };
        try {
            await instance.loadModelFromUrl(
                projectorUrl
                    ? { url: modelFileUrl, mmprojUrl: projectorUrl }
                    : modelFileUrl,
                {
                    n_ctx: contextSize,
                    n_threads: threads,
                    // cap chain-of-thought tokens, long thinking makes replies slow
                    reasoning_budget_tokens: limits.maxThinkingTokens,
                    // this engine is the CPU fallback, never offload to a GPU
                    n_gpu_layers: 0,
                    useCache: true,
                    jinja: true,
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
                const
                    instance = await getWllama(),
                    entries = await instance.cacheManager.list();
                return modelFiles(model)
                    .every(file => entries.some(entry => entryOf(entry, file)));
            } catch { return false; };
        },
        hasCache: async () => {
            try {
                const instance = await getWllama();
                return (await instance.cacheManager.list()).length > 0;
            } catch { return false; };
        },
        remove: async (model: ChatModel) => {
            try {
                const instance = await getWllama();
                await instance.cacheManager.deleteMany(entry =>
                    modelFiles(model).some(file => entryOf(entry, file)));
            } catch { };
        },
        purge: async () => {
            try {
                const instance = await getWllama();
                await instance.cacheManager.clear();
            } catch { };
        },
    };

export {
    cpuThreads,
    hasImages,
    imageBuffer,
    startLLM,
    toWllamaMessages,
    wllamaEngine,
};
