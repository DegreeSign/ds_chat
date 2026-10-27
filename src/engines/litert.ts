import type { GpuArtisanConfig } from '@litert-lm/core';
import { defaultLitertAssets } from '../assets/browser';
import { loadLitert } from './litertLoader';
import { litertContextWindow, llmModels } from '../models';
import {
    contentLength,
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
    EngineChunk,
    EngineDelta,
    EngineMessage,
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

const
    /** Cache Storage bucket for the downloaded LiteRT models */
    cacheName = `litertlm-models`,
    /** Smallest Gemma 4 vision budget in tokens */
    visionTokens = 70,
    /** Resumable file store of the GPU engine */
    store = createModelStore(`litert-store`),
    /** GPU executor settings tuned by the LiteRT web chat demo */
    backendConfig: Partial<GpuArtisanConfig> = {
        num_output_candidates: 1,
        wait_for_weight_uploads: true,
        num_decode_steps_per_sync: 3,
        sequence_batch_size: 0,
        supported_lora_ranks: [],
        max_top_k: 40,
        enable_decode_logits: false,
        enable_external_embeddings: false,
        use_submodel: false,
        use_autosized_ringbuffers: true,
    };

/** Whether the LiteRT wasm logs reach the console */
let loggingOn = false;

const
    /** Wasm stdout, quiet unless logging is on */
    wasmOut = (...args: unknown[]) => { if (loggingOn) console.log(...args); },
    /** Wasm stderr, quiet unless logging is on */
    wasmErr = (...args: unknown[]) => { if (loggingOn) console.error(...args); };

/** Open the model cache, absent in Node */
const cacheOpen = async (): Promise<Cache | undefined> => {
    try {
        if (typeof caches == `undefined`) return undefined;
        return await caches.open(cacheName);
    } catch { return undefined; };
};

/** Whether one model file is stored, in the cache or on disk */
const modelCached = async (model: ChatModel): Promise<boolean> => {
    const litert = model.litert;
    if (!litert) return false;
    const
        url = modelUrl(litert.repo, litert.file),
        [cache, stored] = await Promise.all([cacheOpen(), store.stored(url)]);
    if (stored?.complete) return true;
    try {
        return !!(cache && await cache.match(url));
    } catch { return false; };
};

/** Every model file download in flight, shared by every caller */
const downloads = new Map<string, Promise<void>>();

/** Stream one response body, reporting its download progress */
const countStream = (
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
};

/** Fetch one model file into the cache, once per URL */
const cacheModel = async (
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
        // the whole file lands on disk before the engine reads it back
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
};

/** Stream one model file from the network, for a cache the browser rejects */
const fetchModel = async (
    url: string,
    signal: AbortSignal | undefined,
    onProgress: StartLlmParams[`onProgress`],
): Promise<ReadableStream<Uint8Array>> => {
    const response = await fetch(url, { signal });
    if (!response.ok || !response.body)
        throw new Error(`Model download failed`);
    return countStream(response.body, contentLength(response), onProgress);
};

/** Map built messages to LiteRT turns */
const toLitertMessages = async (
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
};

/** Whether two built turns carry the same role and content */
const sameMessage = (
    first: EngineMessage,
    next: EngineMessage,
): boolean => {
    if (first.role != next.role) return false;
    if (typeof first.content == `string` || typeof next.content == `string`)
        return first.content == next.content;
    if (first.content.length != next.content.length) return false;
    for (let i = 0; i < first.content.length; i++) {
        const
            left = first.content[i],
            right = next.content[i];
        if (left.type != right.type) return false;
        if (left.type == `text` && right.type == `text`) {
            if (left.text != right.text) return false;
        } else if ((left.type == `image` && right.type == `image`)
            || (left.type == `audio` && right.type == `audio`)) {
            if (left.url != right.url) return false;
        };
    };
    return true;
};

/** Whether the live conversation already holds the incoming history */
const continuesHistory = (
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
};

/** Stream one LiteRT reply as engine chunks */
const streamLitert = async function* ({
    engine,
    mod,
    params,
    messages,
    session,
}: StreamLitertParams): AsyncGenerator<EngineChunk> {
    const
        last = messages[messages.length - 1],
        options = replyOptions(params.limits, params.reasoning);
    if (last?.role != `user`) throw new Error(`No user turn`);
    const
        history = messages.slice(0, -1),
        prompt = (await toLitertMessages([last]))[0];
    if (!prompt) throw new Error(`Empty prompt`);
    const reuse = !!session.conversation
        && session.reasoning == params.reasoning
        && session.maxTokens == options.max_tokens
        && continuesHistory(session.sent, history);
    let conversation: import('@litert-lm/core').Conversation;
    if (reuse && session.conversation)
        conversation = session.conversation;
    else {
        // history media becomes text notes
        const previous = await toLitertMessages(history, false);
        session.conversation = undefined;
        session.sent = [];
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
        session.conversation = conversation;
        session.reasoning = params.reasoning;
        session.maxTokens = options.max_tokens;
        session.sent = [...history];
    };
    session.sent.push(last);
    let
        reader: ReadableStreamDefaultReader<LitertMessage> | undefined,
        completed = false,
        reply = ``;
    const stop = () => {
        if (reader) void reader.cancel().catch(() => { });
        try { conversation.cancel(); } catch { };
    };
    params.signal?.addEventListener(`abort`, stop, { once: true });
    try {
        if (params.signal?.aborted) return;
        const current = conversation.sendMessageStreaming(prompt).getReader();
        reader = current;
        while (true) {
            const { done, value } = await current.read();
            if (done) break;
            const delta: EngineDelta = {};
            let text = typeof value.content == `string` ? value.content : ``;
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
        params.signal?.removeEventListener(`abort`, stop);
        // keep the conversation open
        if (completed && reply)
            session.sent.push({ role: `assistant`, content: reply });
        else {
            session.conversation = undefined;
            session.sent = [];
        };
    }
};

/** Stream one reply on a started GPU runtime */
const chatOn = async ({
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
        return await runEngineChat({
            model,
            params,
            stopped: () => !!params.signal?.aborted,
            onStall: reset,
            start: async messages => {
                if (params.signal?.aborted) throw new Error(`Cancelled`);
                if (hasImages(messages) && !model.litert?.vision)
                    throw new Error(`Model does not accept images`);
                if (hasAudio(messages) && !model.litert?.audio)
                    throw new Error(`Model does not accept audio`);
                return streamLitert({ engine, mod, params, messages, session });
            },
        });
    } catch (error) {
        reset();
        throw error;
    };
};

/** Build one engine settings object with the small vision budget */
const litertSettings = ({
    model,
    limits,
    source,
    mod,
}: LitertSettingsParams): LitertSettings => {
    const litert = model.litert;
    return {
        model: source,
        mainExecutorSettings: {
            maxNumTokens: litertContextWindow,
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
        // audio encoder on demand, the Gemma 4 build requires the CPU backend
        ...(litert?.audio ? { audioBackend: mod.Backend.CPU } : {}),
    };
};

/** Start the GPU runtime, the unified engine entry */
const startLLM = async ({
    model,
    limits,
    onProgress,
    signal,
    logging,
}: StartLlmParams): Promise<LlmRuntime> => {
    loggingOn = logging === true;
    const litert = model.litert;
    if (!litert) throw new Error(`Model has no LiteRT artifact`);
    const mod = await loadLitert();
    const
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
        url = modelUrl(litert.repo, litert.file),
        cache = await cacheOpen();
    let source: ReadableStream<Uint8Array> | undefined;
    // a complete file in either store needs no network
    const legacy = cache ? await cache.match(url) : undefined;
    if (legacy?.body) source = legacy.body;
    else {
        const stored = await store.stored(url);
        if (stored?.complete) source = stored.file.stream();
    };
    if (!source) {
        // the file store keeps what it fetches, so a retry resumes it
        const saved = await store.download({ url, signal, onProgress })
            .catch(error => {
                if (signal?.aborted) throw new Error(`Cancelled`);
                // a store the browser cannot write still loads from the network
                if (!isStoreError(error)) throw error;
                if (logging) console.log(`Local model store failed`, error);
                return undefined;
            });
        if (saved) source = saved.file.stream();
    };
    if (!source && cache) {
        try {
            await cacheModel(url, cache, signal, onProgress);
            const hit = await cache.match(url);
            if (hit?.body) source = hit.body;
        } catch (error) {
            if (signal?.aborted) throw new Error(`Cancelled`);
            if (logging) console.log(`Local model cache failed`, error);
        };
    };
    // a host without a file system still loads from the network stream
    if (!source) source = await fetchModel(url, signal, onProgress);
    if (signal?.aborted) throw new Error(`Cancelled`);
    onProgress(1, LlmPhase.load);
    const engine = await mod.Engine.create(
        litertSettings({ model, limits, source, mod }));
    if (signal?.aborted) {
        await engine.delete();
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
        contextSize: litertContextWindow,
        chat: params => chatOn({ engine, model, mod, params, session }),
        unload: async () => {
            session.conversation = undefined;
            session.sent = [];
            await engine.delete();
        },
    };
};

const litertEngine: LlmEngine = {
    backend: LlmBackend.gpu,
    startLLM,
    cached: modelCached,
    hasCache: async () => {
        try {
            for (const model of llmModels) {
                const litert = model.litert;
                if (!litert) continue;
                const stored = await store.stored(
                    modelUrl(litert.repo, litert.file));
                if (stored) return true;
            };
            const cache = await cacheOpen();
            return cache ? (await cache.keys()).length > 0 : false;
        } catch { return false; };
    },
    remove: async model => {
        try {
            const litert = model.litert;
            if (!litert) return;
            const
                url = modelUrl(litert.repo, litert.file),
                cache = await cacheOpen();
            await store.remove(url);
            if (cache) await cache.delete(url);
        } catch { };
    },
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
    litertEngine,
    litertSettings,
    streamLitert,
    toLitertMessages,
    visionTokens,
};
