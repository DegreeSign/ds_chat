import type { GpuArtisanConfig } from '@litert-lm/core';
import { defaultLitertAssets } from '../assets/browser';
import { loadLitert } from './litertLoader';
import { litertContextWindow } from '../models';
import {
    hasImages,
    modelUrl,
    replyOptions,
    runEngineChat,
} from './engine';
import { imageBuffer } from './images';
import { LlmBackend, LlmPhase } from '../enums';
import type {
    ChatModel,
    EngineChunk,
    EngineDelta,
    EngineMessage,
    LitertChatParams,
    LitertContentPart,
    LitertMessage,
    LlmEngine,
    LlmRuntime,
    StartLlmParams,
    StreamLitertParams,
} from '../types';

const
    /** Cache Storage bucket for the downloaded LiteRT models */
    cacheName = `litertlm-models`,
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

/** Open the model cache, absent in Node */
const cacheOpen = async (): Promise<Cache | undefined> => {
    try {
        if (typeof caches == `undefined`) return undefined;
        return await caches.open(cacheName);
    } catch { return undefined; };
};

/** Whether one model file is in the cache */
const modelCached = async (model: ChatModel): Promise<boolean> => {
    try {
        const
            artifact = model.litert,
            cache = await cacheOpen();
        if (!artifact || !cache) return false;
        return !!(await cache.match(modelUrl(artifact.repo, artifact.file)));
    } catch { return false; };
};

/** Map built messages to LiteRT turns */
const toLitertMessages = async (
    messages: EngineMessage[],
): Promise<LitertMessage[]> => {
    const result: LitertMessage[] = [];
    for (const message of messages) {
        if (typeof message.content == `string`) {
            result.push({ role: message.role, content: message.content });
            continue;
        };
        const parts: LitertContentPart[] = [];
        for (const part of message.content)
            parts.push(part.type == `text`
                ? { type: `text`, text: part.text }
                : { type: `image`, data: await imageBuffer(part.url) });
        result.push({ role: `user`, content: parts });
    };
    return result;
};

/** Stream one LiteRT reply as engine chunks */
const streamLitert = async function* ({
    engine,
    mod,
    params,
    messages,
}: StreamLitertParams): AsyncGenerator<EngineChunk> {
    const
        last = messages[messages.length - 1],
        options = replyOptions(params.limits, params.reasoning);
    if (last?.role != `user`) throw new Error(`No user turn`);
    const
        previous = await toLitertMessages(messages.slice(0, -1)),
        prompt = (await toLitertMessages([last]))[0];
    if (!prompt) throw new Error(`Empty prompt`);
    const conversation = await engine.createConversation({
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
    });
    let reader: ReadableStreamDefaultReader<LitertMessage> | undefined;
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
            if (text) delta.content = text;
            const thought = value.channels?.[`thought`];
            if (thought) delta.reasoning = thought;
            if (delta.content || delta.reasoning)
                yield { choices: [{ delta }] };
        }
    } finally {
        params.signal?.removeEventListener(`abort`, stop);
        try { await conversation.delete(); } catch { };
    }
};

/** Stream one reply on a started GPU runtime */
const chatOn = async ({
    engine,
    model,
    mod,
    params,
}: LitertChatParams): Promise<string | undefined> =>
    await runEngineChat({
        model,
        params,
        stopped: () => !!params.signal?.aborted,
        start: async messages => {
            if (params.signal?.aborted) throw new Error(`Cancelled`);
            if (hasImages(messages) && !model.litert?.vision)
                throw new Error(`Model does not accept images`);
            return streamLitert({ engine, mod, params, messages });
        },
    });

/** Start the GPU runtime, the unified engine entry */
const startLLM = async ({
    model,
    limits,
    onProgress,
    signal,
    logging,
}: StartLlmParams): Promise<LlmRuntime> => {
    const artifact = model.litert;
    if (!artifact) throw new Error(`Model has no LiteRT artifact`);
    const mod = await loadLitert();
    await mod.getOrLoadGlobalLiteRtLm(defaultLitertAssets().script);
    if (signal?.aborted) throw new Error(`Cancelled`);
    const
        url = modelUrl(artifact.repo, artifact.file),
        cache = await cacheOpen(),
        hit = cache ? await cache.match(url) : undefined;
    let source: ReadableStream<Uint8Array>;
    if (hit?.body) {
        source = hit.body;
        onProgress(1, LlmPhase.load);
    } else {
        const response = await fetch(url, { signal });
        if (!response.ok || !response.body)
            throw new Error(`Model download failed`);
        const total = Number(response.headers.get(`content-length`)) || 0;
        let loaded = 0;
        const counted = response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
                transform: (chunk, controller) => {
                    loaded += chunk.byteLength;
                    onProgress(
                        total ? loaded / total : 0,
                        LlmPhase.download,
                    );
                    controller.enqueue(chunk);
                },
            }),
        );
        if (cache) {
            const [forEngine, forCache] = counted.tee();
            void cache.put(url, new Response(forCache, {
                headers: {
                    'content-type': `application/octet-stream`,
                    ...(total ? { 'content-length': `${total}` } : {}),
                },
            })).catch(error => {
                if (logging) console.log(`Local model cache failed`, error);
            });
            source = forEngine;
        } else source = counted;
    };
    if (signal?.aborted) throw new Error(`Cancelled`);
    onProgress(1, LlmPhase.load);
    const engine = await mod.Engine.create({
        model: source,
        mainExecutorSettings: {
            maxNumTokens: litertContextWindow,
            ...(artifact.vision
                ? { maxNumImages: Math.max(1, limits.maxImages) }
                : {}),
            backendConfig,
        },
        ...(artifact.vision ? { visionBackend: mod.Backend.GPU } : {}),
    });
    if (signal?.aborted) {
        await engine.delete();
        throw new Error(`Cancelled`);
    };
    return {
        model,
        backend: LlmBackend.gpu,
        contextSize: litertContextWindow,
        chat: params => chatOn({ engine, model, mod, params }),
        unload: async () => { await engine.delete(); },
    };
};

const litertEngine: LlmEngine = {
    backend: LlmBackend.gpu,
    startLLM,
    cached: modelCached,
    hasCache: async () => {
        try {
            const cache = await cacheOpen();
            return cache ? (await cache.keys()).length > 0 : false;
        } catch { return false; };
    },
    remove: async model => {
        try {
            const
                artifact = model.litert,
                cache = await cacheOpen();
            if (!artifact || !cache) return;
            await cache.delete(modelUrl(artifact.repo, artifact.file));
        } catch { };
    },
    purge: async () => {
        try {
            if (typeof caches != `undefined`) await caches.delete(cacheName);
        } catch { };
    },
};

export {
    litertEngine,
    toLitertMessages,
};
