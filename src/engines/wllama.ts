import type { CacheEntry, Wllama, WllamaLogger } from '@wllama/wllama/esm/index.js';
import { defaultWllamaAssets } from '../assets/browser';
import { loadWllama } from './loader';
import { contextWindow } from '../core/models';
import {
    hasAudio,
    hasImages,
    modelUrl,
    replyOptions,
    runEngineChat,
} from './engine';
import { createModelStore } from './store';
import { heuristicThreads } from './threads';
import { contentBuffer, imageTokens } from './images';
import { log } from '../core/log';
import { ChatModelId, LlmBackend, LlmPhase } from '../types/enums';
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

let
    wllama: Wllama | undefined,
    assets: WllamaAssets | undefined,
    assetsKey = ``,
    /** Whether this call wants logs */
    loggingOn = false;
const
    /** GPU probe log to ignore */
    gpuProbeLog = `ggml_webgpu: Failed to get an adapter`,
    /** Resumable store of CPU engine */
    store = createModelStore(`wllama-store`),
    /** Ids with instruct vision window */
    instructIds = [
        ChatModelId.qwen3_vl_2b_instruct,
        ChatModelId.qwen3_vl_2b_instruct_q3,
    ],
    /** Image limits of one model */
    visionLimits = (model: ChatModel) =>
        model.cpu?.mmproj && instructIds.includes(model.id)
            ? { image_min_tokens: 16, image_max_tokens: imageTokens }
            : {},
    /** Stable key for asset set */
    assetsKeyOf = (value: WllamaAssets): string =>
        `${value.wasm}|${value.compatWasm}|${value.compatWorker}`,
    /** Merge asset overrides over defaults */
    resolveAssets = (overrides?: Partial<WllamaAssets>): WllamaAssets => {
        const defaults = defaultWllamaAssets();
        return {
            wasm: overrides?.wasm || defaults.wasm,
            compatWasm: overrides?.compatWasm || defaults.compatWasm,
            compatWorker: overrides?.compatWorker || defaults.compatWorker,
        };
    },
    /** Logger follows per-call logging flag */
    cpuLogger = (base: WllamaLogger): WllamaLogger => {
        // compat build forwards native logs
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
    /** Lazily create single wllama instance */
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
    /** Drop worker, cannot be reused */
    dropWllama = async () => {
        const instance = wllama;
        wllama = undefined;
        try { await instance?.exit(); } catch { };
    },
    /** Whether cache entry holds file */
    entryOf = (entry: CacheEntry, file: string): boolean =>
        entry.name.includes(file)
        || !!entry.metadata?.originalURL?.includes(file),
    /** CPU file names and URLs */
    cpuFiles = (model: ChatModel): Array<{ name: string, url: string }> => {
        const cpu = model.cpu;
        if (!cpu) return [];
        return [
            { name: cpu.file, url: modelUrl(cpu.repo, cpu.file) },
            ...(cpu.mmproj
                ? [{
                    name: cpu.mmproj.file,
                    url: modelUrl(cpu.mmproj.repo ?? cpu.repo, cpu.mmproj.file),
                }]
                : []),
        ];
    },
    /** Whether all CPU files stored */
    filesStored = async (model: ChatModel): Promise<boolean> => {
        const files = cpuFiles(model);
        if (!files.length) return false;
        for (const file of files) {
            const stored = await store.stored(file.url);
            if (!stored?.complete) return false;
        };
        return true;
    },
    /** Whether all CPU files cached */
    filesCached = async (
        instance: Wllama,
        model: ChatModel,
    ): Promise<boolean> => {
        const
            files = cpuFiles(model),
            models = await instance.modelManager.getModels()
                .catch(() => []);
        return !!files.length && models.some(entry => entry.url == files[0].url);
    },
    /** Complete legacy cache blobs */
    cachedBlobs = async (
        instance: Wllama,
        model: ChatModel,
    ): Promise<Blob[] | undefined> => {
        const files = cpuFiles(model);
        if (!files.length) return undefined;
        const
            models = await instance.modelManager.getModels()
                .catch(() => []),
            hit = models.find(entry => entry.url == files[0].url);
        return hit ? await hit.open().catch(() => undefined) : undefined;
    },
    /** Read one HTTP byte range */
    fetchRange = async (
        url: string,
        start: number,
        end: number,
        signal?: AbortSignal,
    ): Promise<ArrayBuffer> => {
        const response = await fetch(url, {
            signal,
            headers: { Range: `bytes=${start}-${end - 1}` },
        });
        // range keeps memory flat
        if (response.status != 206) {
            await response.body?.cancel().catch(() => { });
            throw new Error(`Model range failed`);
        };
        return await response.arrayBuffer();
    },
    /** Remote file size in bytes */
    remoteSize = async (
        url: string,
        signal?: AbortSignal,
    ): Promise<number> => {
        const response = await fetch(url, { method: `HEAD`, signal });
        await response.body?.cancel().catch(() => { });
        const size = Number(response.headers.get(`content-length`)) || 0;
        if (!response.ok || !size) throw new Error(`Model size unknown`);
        return size;
    },
    /** Stored prefix and network blob */
    tailBlob = ({
        url,
        stored,
        storedSize,
        total,
        signal,
    }: {
        url: string,
        stored?: Blob,
        storedSize: number,
        total: number,
        signal?: AbortSignal,
    }): Blob => {
        const limit = Math.max(0, Math.min(storedSize, total));
        return {
            size: total,
            /** Blob-compatible range */
            slice: (start?: number, end?: number) => ({
                /** Read from both copies */
                arrayBuffer: async (): Promise<ArrayBuffer> => {
                    const
                        first = Math.max(0, Math.min(start ?? 0, total)),
                        last = Math.max(first, Math.min(end ?? total, total));
                    if (last <= first) return new ArrayBuffer(0);
                    // stored prefix holds the range
                    if (stored && last <= limit)
                        return await stored.slice(first, last).arrayBuffer();
                    // range starts past the prefix
                    if (!stored || first >= limit)
                        return await fetchRange(url, first, last, signal);
                    // range crosses the prefix end
                    const
                        head = await stored.slice(first, limit).arrayBuffer(),
                        tail = await fetchRange(url, limit, last, signal),
                        merged = new Uint8Array(
                            head.byteLength + tail.byteLength,
                        );
                    merged.set(new Uint8Array(head));
                    merged.set(new Uint8Array(tail), head.byteLength);
                    return merged.buffer;
                },
            }),
        } as unknown as Blob;
    },
    /** Stored tails and network blobs */
    streamBlobs = async (
        model: ChatModel,
        signal?: AbortSignal,
    ): Promise<Blob[]> => {
        const blobs: Blob[] = [];
        for (const file of cpuFiles(model)) {
            if (signal?.aborted) throw new Error(`Cancelled`);
            const
                stored = await store.stored(file.url),
                // metadata may know the total
                total = stored?.total || await remoteSize(file.url, signal);
            if (!total) throw new Error(`Model size unknown`);
            blobs.push(tailBlob({
                url: file.url,
                stored: stored?.file,
                storedSize: Math.min(stored?.size || 0, total),
                total,
                signal,
            }));
        };
        return blobs;
    },
    /** CPU files as stored blobs */
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
            // no file system streams files
            if (!saved) return undefined;
            blobs.push(saved.file);
        };
        return blobs.length ? blobs : undefined;
    },
    /** Map messages to wllama turns */
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
    /** Stream reply on started CPU */
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
            start: async (messages, maxTokens) => {
                if (hasImages(messages) && !instance.supportInputModality(`image`))
                    throw new Error(`Model does not accept images`);
                if (hasAudio(messages) && !instance.supportInputModality(`audio`))
                    throw new Error(`Model does not accept audio`);
                return await instance.createChatCompletion({
                    messages: await toWllamaMessages(messages),
                    ...replyOptions(
                        params.limits,
                        params.reasoning,
                        params.temperature,
                        maxTokens,
                    ),
                    // stream prompt timings per chunk
                    timings_per_token: true,
                    // stream prefill progress chunks
                    return_progress: true,
                    ...(params.repeatPenalty
                        ? { penalty_repeat: params.repeatPenalty }
                        : {}),
                    abortSignal: params.signal,
                    ...(model.reasoning || instructIds.includes(model.id)
                        ? { chat_template_kwargs: { enable_thinking: params.reasoning } }
                        : {}),
                });
            },
        });
    },
    /** Start CPU runtime engine entry */
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
            /** Context window for this device */
            contextSize = contextWindow(model),
            cpu = model.cpu;
        if (!cpu) throw new Error(`Model has no CPU artifact`);
        const
            next = resolveAssets(overrides),
            key = assetsKeyOf(next);
        // different assets need fresh worker
        if (wllama && key != assetsKey) await dropWllama();
        assets = next;
        assetsKey = key;
        const
            cores = typeof navigator != `undefined`
                ? navigator.hardwareConcurrency : 0,
            threads = Math.min(heuristicThreads(cores), limits.maxThreads),
            instance = await getWllama(),
            complete = await filesStored(model),
            projectorFile = cpu.mmproj?.file;
        if (signal?.aborted) {
            await dropWllama();
            throw new Error(`Cancelled`);
        };
        // text-only cache rejects projector
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
            // one request only
            n_parallel: 1,
            // warm graphs at load
            warmup: true,
            // reasoning models only
            ...(model.reasoning
                ? { reasoning_budget_tokens: limits.maxThinkingTokens }
                : { reasoning_budget_tokens: 0 }),
            n_gpu_layers: 0, // CPU fallback, never use GPU
            jinja: true,
            // shift a full context
            ctx_shift: true,
            n_keep: Math.max(64, Math.round(contextSize / 16)),
            ...visionLimits(model),
        };
        try {
            // complete store skips network
            let blobs = complete
                ? await storedBlobs({ model, signal, onProgress })
                : undefined;
            // complete legacy cache skips download
            if (!blobs)
                blobs = await cachedBlobs(instance, model);
            if (!blobs)
                blobs = await storedBlobs({ model, signal, onProgress })
                    .catch(error => {
                        if (signal?.aborted) throw new Error(`Cancelled`);
                        // failed store streams its tail
                        if (logging) console.log(`Local model store failed`, error);
                        return undefined;
                    });
            // no copy reads stored tail
            if (!blobs) blobs = await streamBlobs(model, signal);
            onProgress(1, LlmPhase.load);
            await instance.loadModel(blobs, loadParams);
        } catch (error) {
            // failed download leaves worker unusable
            await dropWllama();
            throw error;
        };
        if (signal?.aborted) {
            await dropWllama();
            throw new Error(`Cancelled`);
        };
        const info = instance.getLoadedContextInfo();
        // failed context init reports loaded
        // chat would abort wasm module
        if (!info.n_ctx) {
            await dropWllama();
            throw new Error(`Failed to create model context`);
        };
        log(
            logging,
            `CPU engine ready`,
            model.id,
            `cores`,
            typeof navigator != `undefined` ? navigator.hardwareConcurrency : 0,
            `isolated`,
            typeof crossOriginIsolated != `undefined` && crossOriginIsolated,
            `requested`,
            threads,
            `multithread`,
            instance.isMultithread(),
            `active`,
            instance.getNumThreads(),
            `context`,
            info.n_ctx,
            `batch`,
            info.n_batch,
            `ubatch`,
            info.n_ubatch,
        );
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
    startLLM,
    storedBlobs,
    streamBlobs,
    tailBlob,
    toWllamaMessages,
    visionLimits,
    wllamaEngine,
};
