import { rNum } from '@degreesign/utils';
import type { GpuArtisanConfig } from '@litert-lm/core';
import { defaultLitertAssets } from '../assets/browser';
import { loadLitert } from './litertLoader';
import { contextWindow } from '../core/models';
import {
    contentLength,
    hasAudio,
    hasImages,
    modelUrl,
    replyOptions,
    runEngineChat,
} from './engine';
import { createModelStore, isQuotaError } from './store';
import { contentBuffer } from './images';
import { log } from '../core/log';
import { LlmBackend, LlmPhase } from '../types/enums';
import type {
    ChatModel,
    EngineChunk,
    EngineDelta,
    EngineMessage,
    GpuBuffer,
    GpuDevice,
    GpuThrottleParams,
    GpuWasm,
    LitertChatParams,
    LitertContentPart,
    LitertMessage,
    LitertSession,
    LitertSettings,
    LitertSettingsParams,
    LlmEngine,
    LlmRuntime,
    StartLlmParams,
    StreamLitertParams,
} from '../types';

let
    /** Whether wasm logs reach console */
    loggingOn = false,
    /** Live engines, device released last */
    engines = 0;
const
    /** Cache bucket for LiteRT models */
    cacheName = `litertlm-models`,
    /** Smallest Gemma 4 vision budget */
    visionTokens = 70,
    /** GPU busy share of time */
    gpuShare = 1,
    /** Most rest per readback */
    maxRestMs = 500,
    /** Resumable store of GPU engine */
    store = createModelStore(`litert-store`),
    /** One GPU decode per sync */
    backendConfig: Partial<GpuArtisanConfig> = {
        num_output_candidates: 1,
        wait_for_weight_uploads: true,
        num_decode_steps_per_sync: 1,
        sequence_batch_size: 0,
        supported_lora_ranks: [],
        max_top_k: 40,
        enable_decode_logits: false,
        enable_external_embeddings: false,
        use_submodel: false,
        use_autosized_ringbuffers: true,
    };
let
    /** Target GPU busy share */
    activeShare = gpuShare,
    /** Whether a reply is streaming */
    pacing = false,
    /** Last readback time, busy starts */
    lastSync = 0;
const
    /** Devices already GPU throttled */
    pacedDevices = new WeakSet<object>(),
    /** Wasm stdout, quiet unless logging */
    wasmOut = (...args: unknown[]) => { if (loggingOn) console.log(...args); },
    /** Wasm stderr, quiet unless logging */
    wasmErr = (...args: unknown[]) => { if (loggingOn) console.error(...args); },
    /** Turn text without reasoning channel */
    visibleText = (text: string): string => text
        .replace(/<\|channel>thought\n?[\s\S]*?<channel\|>/g, ``)
        .replace(/<\|channel>thought[\s\S]*$/, ``)
        .trim(),
    /** Rest owed for busy interval */
    restFor = (busyMs: number, share = gpuShare): number =>
        Math.min(maxRestMs, Math.max(0, busyMs * (1 / share - 1))),
    /** WebGPU device resting after readback */
    throttledDevice = ({
        device,
        pace,
    }: GpuThrottleParams): GpuDevice => new Proxy(device, {
        get: (target, key) => {
            if (key == `createBuffer`)
                return (...args: unknown[]) => {
                    const
                        buffer = (Reflect.get(target, key, target) as (
                            ...args: unknown[]
                        ) => GpuBuffer).apply(target, args),
                        map = buffer.mapAsync;
                    try {
                        buffer.mapAsync = async (...mapArgs: unknown[]) => {
                            await map.apply(buffer, mapArgs);
                            await pace();
                        };
                    } catch { };
                    return buffer;
                };
            const value = Reflect.get(target, key, target);
            return typeof value == `function` ? value.bind(target) : value;
        },
    }),
    /** Rest GPU after each readback */
    paceGpu = async (): Promise<void> => {
        const
            now = performance.now(),
            busy = now - lastSync;
        lastSync = now;
        if (!pacing) return;
        const rest = Math.round(restFor(busy, activeShare));
        if (rest < 1) return;
        await new Promise<void>(resolve => setTimeout(resolve, rest));
        lastSync = performance.now();
    },
    /** Start pacing after prefill */
    startPacing = (share: number = gpuShare) => {
        activeShare = share > 0 ? share : gpuShare;
        pacing = true;
        lastSync = performance.now();
    },
    /** Stop pacing when reply settles */
    stopPacing = () => {
        pacing = false;
    },
    /** Drop device and wasm module */
    releaseDevice = (mod: Awaited<ReturnType<typeof loadLitert>>) => {
        try {
            const
                wasm = mod.getGlobalLiteRtLm().liteRtLmWasm as GpuWasm,
                device = wasm.preinitializedWebGPUDevice;
            // drop cached device id
            wasm.preinitializedWebGPUDevice = undefined;
            if (wasm.WebGPU) wasm.WebGPU.preinitializedDeviceId = undefined;
            device?.destroy?.();
        } catch { };
        try { mod.unloadLiteRtLm(); } catch { };
    },
    /** Model cache, absent in Node */
    cacheOpen = async (): Promise<Cache | undefined> => {
        try {
            if (typeof caches == `undefined`) return undefined;
            return await caches.open(cacheName);
        } catch { return undefined; };
    },
    /** Whether model file is stored */
    modelCached = async (model: ChatModel): Promise<boolean> => {
        const litert = model.litert;
        if (!litert) return false;
        const
            url = modelUrl(litert.repo, litert.file),
            [cache, stored] = await Promise.all([cacheOpen(), store.stored(url)]);
        if (stored?.complete) return true;
        try {
            return !!(cache && await cache.match(url));
        } catch { return false; };
    },
    /** Downloads in flight, shared */
    downloads = new Map<string, Promise<void>>(),
    /** Stream body with download progress */
    countStream = (
        body: ReadableStream<Uint8Array>,
        total: number,
        onProgress: StartLlmParams[`onProgress`],
    ): ReadableStream<Uint8Array> => {
        let loaded = 0;
        return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
            transform: (chunk, controller) => {
                loaded += chunk.byteLength;
                onProgress(total ? loaded / total : 0, LlmPhase.download);
                controller.enqueue(chunk);
            },
        }));
    },
    /** Cache one file per URL */
    cacheModel = async (
        url: string,
        cache: Cache,
        signal: AbortSignal | undefined,
        onProgress: StartLlmParams[`onProgress`],
    ): Promise<void> => {
        const running = downloads.get(url);
        if (running) return await running;
        const pending = (async () => {
            const response = await fetch(url, { signal });
            if (!response.ok || !response.body)
                throw new Error(`Model download failed`);
            const
                total = contentLength(response),
                body = countStream(response.body, total, onProgress);
            // whole file lands before readback
            await cache.put(url, new Response(body, {
                headers: {
                    'content-type': `application/octet-stream`,
                    ...(total ? { 'content-length': `${total}` } : {}),
                },
            }));
        })().finally(() => {
            downloads.delete(url);
        });
        downloads.set(url, pending);
        return await pending;
    },
    /** Stream model file, cache rejected */
    fetchModel = async (
        url: string,
        signal: AbortSignal | undefined,
        onProgress: StartLlmParams[`onProgress`],
    ): Promise<ReadableStream<Uint8Array>> => {
        const response = await fetch(url, { signal });
        if (!response.ok || !response.body)
            throw new Error(`Model download failed`);
        return countStream(response.body, contentLength(response), onProgress);
    },
    /** Map messages to LiteRT turns */
    toLitertMessages = async (
        messages: EngineMessage[],
        keepMedia = true,
    ): Promise<LitertMessage[]> => {
        const result: LitertMessage[] = [];
        for (const message of messages) {
            if (typeof message.content == `string`) {
                result.push({ role: message.role, content: message.content });
                continue;
            };
            const parts: LitertContentPart[] = [];
            for (const part of message.content) {
                if (part.type == `text`) {
                    parts.push({ type: `text`, text: part.text });
                    continue;
                };
                if (keepMedia) {
                    parts.push({
                        type: part.type,
                        data: await contentBuffer(part.url),
                    });
                    continue;
                };
                // history media becomes text
                parts.push({ type: `text`, text: `[${part.type}]` });
            };
            result.push({ role: message.role, content: parts });
        };
        return result;
    },
    /** Whether two turns are identical */
    sameMessage = (
        first: EngineMessage,
        next: EngineMessage,
    ): boolean => {
        if (first.role != next.role) return false;
        // reply without channel
        if (typeof first.content == `string` || typeof next.content == `string`)
            return typeof first.content == `string`
                && typeof next.content == `string`
                && visibleText(first.content) == visibleText(next.content);
        if (first.content.length != next.content.length) return false;
        for (let i = 0; i < first.content.length; i++) {
            const
                left = first.content[i],
                right = next.content[i];
            if (left.type != right.type) return false;
            if (left.type == `text` && right.type == `text`) {
                if (visibleText(left.text) != visibleText(right.text)) return false;
            } else if (left.type != `text` && right.type != `text`) {
                // re-encoded file keeps place
                if (!!left.url != !!right.url) return false;
            } else return false;
        };
        return true;
    },
    /** Whether conversation holds incoming history */
    continuesHistory = (
        sent: EngineMessage[],
        history: EngineMessage[],
    ): boolean => {
        const
            sentSystem = sent[0]?.role == `system` ? sent[0] : undefined,
            nextSystem = history[0]?.role == `system` ? history[0] : undefined;
        if (!sentSystem != !nextSystem) return false;
        if (sentSystem && nextSystem && !sameMessage(sentSystem, nextSystem))
            return false;
        const
            sentTurns = sentSystem ? sent.slice(1) : sent,
            nextTurns = nextSystem ? history.slice(1) : history;
        if (!nextTurns.length || nextTurns.length > sentTurns.length) return false;
        const offset = sentTurns.length - nextTurns.length;
        for (let i = 0; i < nextTurns.length; i++)
            if (!sameMessage(sentTurns[offset + i], nextTurns[i])) return false;
        return true;
    },
    /** Stream LiteRT reply as chunks */
    streamLitert = async function* ({
        engine,
        mod,
        params,
        messages,
        maxTokens,
        session,
    }: StreamLitertParams): AsyncGenerator<EngineChunk> {
        const
            last = messages[messages.length - 1],
            options = replyOptions(
                params.limits,
                params.reasoning,
                params.temperature,
                maxTokens,
            );
        if (last?.role != `user`) throw new Error(`No user turn`);
        const
            history = messages.slice(0, -1),
            prompt = (await toLitertMessages([last]))[0];
        if (!prompt) throw new Error(`Empty prompt`);
        let conversation: import('@litert-lm/core').Conversation;
        const
            sameFlags = session.reasoning == params.reasoning
                && session.maxTokens == options.max_tokens,
            sameHistory = !!session.conversation
                && continuesHistory(session.sent, history),
            reuse = sameFlags && sameHistory;
        if (reuse && session.conversation) {
            log(loggingOn, `LiteRT conversation reused`, session.sent.length);
            conversation = session.conversation;
        } else {
            // history media becomes text notes
            const previous = await toLitertMessages(history, false);
            session.conversation = undefined;
            session.sent = [];
            const startedAt = performance.now();
            conversation = await engine.createConversation({
                sessionConfig: {
                    maxOutputTokens: options.max_tokens,
                    samplerParams: {
                        type: mod.SamplerType.TOP_K,
                        temperature: options.temperature,
                        k: 40,
                        p: 0.95,
                    },
                },
                preface: {
                    ...(previous.length ? { messages: previous } : {}),
                    extra_context: { enable_thinking: params.reasoning },
                },
                prefillPrefaceOnInit: previous.length > 0,
            });
            log(
                loggingOn,
                `LiteRT conversation created`,
                previous.length,
                Math.round(performance.now() - startedAt),
                `flags`,
                sameFlags,
                `history`,
                sameHistory,
            );
            session.conversation = conversation;
            session.reasoning = params.reasoning;
            session.maxTokens = options.max_tokens;
            session.sent = [...history];
        };
        session.sent.push(last);
        let
            reader: ReadableStreamDefaultReader<LitertMessage> | undefined,
            completed = false,
            first = true,
            reply = ``;
        const stop = () => {
            if (reader) void reader.cancel().catch(() => { });
            try { void Promise.resolve(conversation.cancel()).catch(() => { }); }
            catch { };
        };
        params.signal?.addEventListener(`abort`, stop, { once: true });
        try {
            if (params.signal?.aborted) return;
            const current = conversation.sendMessageStreaming(prompt).getReader();
            reader = current;
            while (true) {
                const
                    readAt = performance.now(),
                    // aborted read ends the stream
                    { done, value } = await current.read().catch(error => {
                        if (params.signal?.aborted)
                            return { done: true, value: undefined } as
                                ReadableStreamReadResult<LitertMessage>;
                        throw error;
                    }),
                    busyMs = performance.now() - readAt;
                if (done) break;
                // first chunk carries prefill
                const prefill = first;
                first = false;
                if (prefill) {
                    log(loggingOn, `LiteRT first chunk`, Math.round(busyMs));
                    // decode rests after prefill
                    startPacing(params.limits.gpuShare);
                };
                let text = typeof value.content == `string` ? value.content : ``;
                const delta: EngineDelta = {};
                if (Array.isArray(value.content))
                    for (const part of value.content)
                        if (part.type == `text`) text += part.text;
                if (text) {
                    delta.content = text;
                    reply += text;
                };
                const thought = value.channels?.[`thought`];
                if (thought) delta.reasoning = thought;
                if (delta.content || delta.reasoning)
                    yield { choices: [{ delta }] };
            };
            completed = true;
        } finally {
            stopPacing();
            params.signal?.removeEventListener(`abort`, stop);
            // keep the conversation open
            if (completed && reply)
                session.sent.push({ role: `assistant`, content: reply });
            else {
                session.conversation = undefined;
                session.sent = [];
            };
        }
    },
    /** Stream reply on started GPU */
    chatOn = async ({
        engine,
        model,
        mod,
        params,
        session,
    }: LitertChatParams): Promise<string | undefined> => {
        loggingOn = params.logging === true;
        const reset = () => {
            try { session.conversation?.cancel(); } catch { };
            session.conversation = undefined;
            session.sent = [];
        };
        try {
            const
                result = await runEngineChat({
                    model,
                    params,
                    stopped: () => !!params.signal?.aborted,
                    onStall: reset,
                    start: async (messages, maxTokens) => {
                        if (params.signal?.aborted) throw new Error(`Cancelled`);
                        if (hasImages(messages) && !model.litert?.vision)
                            throw new Error(`Model does not accept images`);
                        if (hasAudio(messages) && !model.litert?.audio)
                            throw new Error(`Model does not accept audio`);
                        return streamLitert({
                            engine,
                            mod,
                            params,
                            messages,
                            maxTokens,
                            session,
                        });
                    },
                }),
                conversation = session.conversation;
            // report prefill once stream closes
            if (conversation && params.onPromptSpeed && !params.signal?.aborted) {
                const
                    info = await conversation.getBenchmarkInfo()
                        .catch(() => undefined),
                    speed = info?.lastPrefillTokensPerSecond;
                if (typeof speed == `number`
                    && Number.isFinite(speed)
                    && speed > 0)
                    params.onPromptSpeed(rNum(speed));
            };
            return result;
        } catch (error) {
            reset();
            throw error;
        };
    },
    /** Engine settings with vision budget */
    litertSettings = ({
        model,
        limits,
        contextSize,
        source,
        mod,
    }: LitertSettingsParams): LitertSettings => {
        const litert = model.litert;
        return {
            model: source,
            mainExecutorSettings: {
                maxNumTokens: contextSize,
                ...(litert?.vision
                    ? { maxNumImages: Math.max(1, limits.maxImages) }
                    : {}),
                backendConfig,
            },
            // one small signature
            ...(litert?.vision
                ? {
                    visionBackend: mod.Backend.GPU,
                    maxVisionTokensPerImage: visionTokens,
                    minVisionTokensPerImage: visionTokens,
                }
                : {}),
            // audio encoder requires CPU backend
            ...(litert?.audio ? { audioBackend: mod.Backend.CPU } : {}),
        };
    },
    /** Start GPU runtime engine entry */
    startLLM = async ({
        model,
        limits,
        onProgress,
        signal,
        logging,
    }: StartLlmParams): Promise<LlmRuntime> => {
        loggingOn = logging === true;
        const litert = model.litert;
        if (!litert) throw new Error(`Model has no LiteRT artifact`);
        const
            contextSize = contextWindow(model),
            mod = await loadLitert(),
            scope = globalThis as { Module?: unknown },
            previous = scope.Module;
        scope.Module = { print: wasmOut, printErr: wasmErr };
        try {
            await mod.getOrLoadGlobalLiteRtLm(defaultLitertAssets().script);
        } finally {
            scope.Module = previous;
        };
        if (signal?.aborted) throw new Error(`Cancelled`);
        const
            litertLm = mod.getGlobalLiteRtLm(),
            wasm = litertLm.liteRtLmWasm as GpuWasm;
        await litertLm.setupDefaultWebGpuDevice();
        if (signal?.aborted) throw new Error(`Cancelled`);
        const device = wasm.preinitializedWebGPUDevice;
        if (!device) throw new Error(`No WebGPU device`);
        // rest between decode readbacks
        if (!pacedDevices.has(device)) {
            const paced = throttledDevice({ device, pace: paceGpu });
            pacedDevices.add(device);
            pacedDevices.add(paced);
            wasm.preinitializedWebGPUDevice = paced;
        };
        let
            source: ReadableStream<Uint8Array> | undefined,
            /** Full storage skips the cache */
            quotaFull = false;
        const
            url = modelUrl(litert.repo, litert.file),
            cache = await cacheOpen(),
            // complete file needs no network
            legacy = cache ? await cache.match(url) : undefined;
        if (legacy?.body) source = legacy.body;
        else {
            const stored = await store.stored(url);
            if (stored?.complete) source = stored.file.stream();
        };
        if (!source) {
            // file store keeps fetched parts
            const saved = await store.download({ url, signal, onProgress })
                .catch(error => {
                    if (signal?.aborted) throw new Error(`Cancelled`);
                    // stream when the store fails
                    if (logging) console.log(`Local model store failed`, error);
                    quotaFull = isQuotaError(error);
                    return undefined;
                });
            if (saved) source = saved.file.stream();
        };
        if (!source && cache && !quotaFull) {
            try {
                await cacheModel(url, cache, signal, onProgress);
                const hit = await cache.match(url);
                if (hit?.body) source = hit.body;
            } catch (error) {
                if (signal?.aborted) throw new Error(`Cancelled`);
                if (logging) console.log(`Local model cache failed`, error);
            };
        };
        // no file system streams network
        if (!source) source = await fetchModel(url, signal, onProgress);
        if (signal?.aborted) throw new Error(`Cancelled`);
        onProgress(1, LlmPhase.load);
        const engine = await mod.Engine.create(
            litertSettings({ model, limits, contextSize, source, mod }));
        engines += 1;
        /** Release engine and device together */
        const releaseEngine = () => {
            engines = Math.max(0, engines - 1);
            if (!engines) releaseDevice(mod);
        };
        // first conversation builds environment
        try {
            const
                startedAt = performance.now(),
                warm = await engine.createConversation();
            await warm.delete();
            log(
                loggingOn,
                `LiteRT conversation warm-up`,
                Math.round(performance.now() - startedAt),
            );
        } catch (error) {
            log(loggingOn, `LiteRT conversation warm-up failed`, error);
        };
        if (signal?.aborted) {
            await engine.delete();
            releaseEngine();
            throw new Error(`Cancelled`);
        };
        const session: LitertSession = {
            sent: [],
            reasoning: false,
            maxTokens: 0,
        };
        return {
            model,
            backend: LlmBackend.gpu,
            contextSize,
            chat: params => chatOn({ engine, model, mod, params, session }),
            unload: async () => {
                const conversation = session.conversation;
                session.conversation = undefined;
                session.sent = [];
                try { await conversation?.delete(); } catch { };
                await engine.delete();
                releaseEngine();
            },
        };
    },
    litertEngine: LlmEngine = {
        backend: LlmBackend.gpu,
        startLLM,
        cached: modelCached,
        purge: async () => {
            try {
                await store.purge();
                if (typeof caches != `undefined`) await caches.delete(cacheName);
            } catch { };
        },
    };

export {
    cacheModel,
    continuesHistory,
    gpuShare,
    litertEngine,
    litertSettings,
    maxRestMs,
    releaseDevice,
    restFor,
    streamLitert,
    throttledDevice,
    toLitertMessages,
    visionTokens,
};
