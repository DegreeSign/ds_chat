// Browser test harness for @degreesign/chat.
import * as entry from "../src/index";
import { createChat, preloadModel } from "../src/index";
import { createChatOn, createPreloadOn } from "../src/chat";
import { createRuntime } from "../src/service";
import {
    buildMessages,
    createThinkSplitter,
    defaultLlmLimits,
    hasAudio,
    hasImages,
    modelUrl,
    replyOptions,
    resolveLlmLimits,
    runEngineChat,
    streamReply,
} from "../src/engines/engine";
import {
    cpuContextWindow,
    defaultLlmModel,
    findLlmModel,
    litertArtifact,
    litertContextWindow,
    llmModels,
    mobileCpuContextWindow,
    mobileDevice,
    resolveLlmModel,
    supportsAudio,
    supportsImages,
} from "../src/models";
import {
    cpuFiles,
    cpuThreads,
    storedBlobs,
    toWllamaMessages,
} from "../src/engines/wllama";
import {
    cacheModel,
    continuesHistory,
    litertSettings,
    streamLitert,
    toLitertMessages,
    visionTokens,
} from "../src/engines/litert";
import {
    chainParts,
    createModelStore,
    isStoreError,
    resumePlan,
} from "../src/engines/store";
import {
    imageSide,
    contentBuffer,
    resizeImageUrl,
    resizeImages,
} from "../src/engines/images";
import {
    ChatModelId,
    ChatStatus,
    LlmBackend,
    LlmPhase,
    LlmRole,
    LlmStatus,
} from "../src/enums";
import type {
    ChatMessage,
    ChatModel,
    ChatStatusSnapshot,
    EngineChatParams,
    EngineMessage,
    LitertEngine,
    LitertModule,
    LitertSession,
} from "../src/types";
import type { FakeEngineOptions } from "./fixtures.js";
import { createFakeEngine } from "./fixtures.js";

/** One test outcome. */
interface Outcome {
    name: string;
    ok: boolean;
    error?: string;
}

const
    outcomes: Outcome[] = [],
    testStore = createModelStore(`ds-chat-test-store`),
    cpuStore = createModelStore(`wllama-store`),
    sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    /** Run one test and record its outcome. */
    test = async (name: string, run: () => void | Promise<void>) => {
        try {
            await run();
            outcomes.push({ name, ok: true });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            outcomes.push({ name, ok: false, error: message });
        }
    },
    assert = (condition: unknown, message: string): void => {
        if (!condition) throw new Error(message);
    },
    assertEqual = (actual: unknown, expected: unknown, label: string): void => {
        if (actual !== expected)
            throw new Error(`${label}: expected ${String(expected)} got ${String(actual)}`);
    },
    /** A promise resolved by the test. */
    deferred = () => {
        let resolve = () => { };
        const promise = new Promise<void>(result => { resolve = result; });
        return { promise, resolve };
    },
    /** Poll a condition until it holds. */
    waitFor = async (check: () => boolean, label: string) => {
        for (let i = 0; i < 100; i++) {
            if (check()) return;
            await sleep(2);
        };
        throw new Error(`${label}: timed out`);
    },
    /** Resolve one catalog model or fail the test. */
    modelOf = (id: ChatModelId): ChatModel => {
        const model = findLlmModel(id);
        if (!model) throw new Error(`missing model ${id}`);
        return model;
    },
    /** Build a runtime over one fake engine. */
    runtimeWith = (options: FakeEngineOptions = {}) => {
        const
            backend = options.backend ?? LlmBackend.cpu,
            engine = createFakeEngine({ backend, ...options }),
            runtime = createRuntime({
                engines: backend == LlmBackend.gpu
                    ? { litert: engine.engine }
                    : { cpu: engine.engine },
                backend,
            });
        return { ...engine, runtime };
    },
    /** Build a one-shot chat over one fake CPU engine. */
    chatWith = (options: FakeEngineOptions = {}) => {
        const base = runtimeWith(options);
        return { ...base, chat: createChatOn(base.runtime) };
    },
    userMessage = (content: string): ChatMessage => ({
        role: LlmRole.user,
        content,
    }),
    /** Consume one fake engine stream. */
    streamOf = (...chunks: unknown[]) => (async function* () {
        for (const chunk of chunks) yield chunk;
    })(),
    /** A real JPEG with a centered square */
    paintImage = (width: number, height: number): string => {
        const canvas = document.createElement(`canvas`);
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext(`2d`);
        if (!context) throw new Error(`canvas unavailable`);
        context.fillStyle = `#c00`;
        context.fillRect(0, 0, width, height);
        const side = Math.min(width, height);
        context.fillStyle = `#0a0`;
        context.fillRect(
            (width - side) / 2,
            (height - side) / 2,
            side,
            side,
        );
        return canvas.toDataURL(`image/jpeg`, 0.95);
    };

const definitions: Array<{
    name: string;
    run: () => void | Promise<void>;
}> = [
        {
            name: `exports`,
            run: () => {
                assertEqual(typeof createChat, `function`, `createChat`);
                assertEqual(typeof preloadModel, `function`, `preloadModel`);
                assertEqual(typeof createChatOn, `function`, `createChatOn`);
                assertEqual(typeof createPreloadOn, `function`, `createPreloadOn`);
                assertEqual(typeof createRuntime, `function`, `createRuntime`);
                const names = Object.keys(entry).sort();
                assertEqual(
                    names.join(`,`),
                    [
                        `ChatModelId`,
                        `ChatStatus`,
                        `LlmBackend`,
                        `LlmPhase`,
                        `LlmRole`,
                        `LlmStatus`,
                        `createChat`,
                        `preloadModel`,
                    ].join(`,`),
                    `public names`,
                );
                assertEqual(`createChatOn` in entry, false, `internal chat factory`);
                assertEqual(ChatStatus.online, 0, `online`);
                assertEqual(ChatStatus.away, 1, `away`);
                assertEqual(ChatStatus.offline, 2, `offline`);
                assertEqual(LlmStatus.ready, 2, `ready`);
                assertEqual(LlmBackend.cpu, `cpu`, `cpu backend`);
                assertEqual(LlmBackend.gpu, `gpu`, `gpu backend`);
                assertEqual(LlmPhase.download, `download`, `download phase`);
                assertEqual(LlmRole.assistant, `assistant`, `assistant role`);
                assertEqual(ChatModelId.qwen3_vl_2b, `qwen3-vl-2b`, `qwen id`);
                assertEqual(ChatModelId.gemma4_e2b, `gemma4-e2b`, `gemma id`);
            },
        },
        {
            name: `models/catalog`,
            run: () => {
                assertEqual(llmModels.length, 2, `catalog size`);
                assertEqual(cpuContextWindow, 8192, `cpu window`);
                assertEqual(litertContextWindow, 4096, `gpu window`);
                assertEqual(
                    modelOf(ChatModelId.qwen3_vl_2b).reasoning,
                    true,
                    `qwen reasoning`,
                );
                assertEqual(
                    modelOf(ChatModelId.qwen3_vl_2b).cpu?.mmproj?.file,
                    `mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf`,
                    `vision projector`,
                );
                assertEqual(
                    supportsImages(modelOf(ChatModelId.qwen3_vl_2b)),
                    true,
                    `cpu images`,
                );
                assertEqual(
                    supportsAudio(modelOf(ChatModelId.qwen3_vl_2b)),
                    false,
                    `cpu no audio`,
                );
                const gemma = modelOf(ChatModelId.gemma4_e2b);
                assertEqual(gemma.reasoning, true, `gemma reasoning`);
                assertEqual(
                    gemma.litert?.file,
                    `gemma-4-E2B-it.litertlm`,
                    `gemma file`,
                );
                assertEqual(gemma.litert?.vision, true, `gemma vision`);
                assertEqual(gemma.litert?.audio, true, `gemma audio`);
                assertEqual(
                    gemma.litert?.web?.file,
                    `gemma-4-E2B-it-gpu.litertlm`,
                    `gemma mobile file`,
                );
                assertEqual(gemma.litert?.web?.vision, false, `mobile vision`);
                assertEqual(gemma.litert?.web?.audio, false, `mobile audio`);
                assertEqual(supportsImages(gemma), true, `gpu images`);
                assertEqual(supportsAudio(gemma), true, `gpu audio`);
                assertEqual(supportsImages(gemma, true), false, `mobile images`);
                assertEqual(supportsAudio(gemma, true), false, `mobile audio`);
                const textOnly: ChatModel = {
                    id: ChatModelId.qwen3_vl_2b,
                    reasoning: false,
                    cpu: { repo: `text-only`, file: `text-only.gguf` },
                };
                assertEqual(
                    supportsImages(textOnly),
                    false,
                    `text images`,
                );
                assertEqual(supportsAudio(textOnly), false, `text audio`);
                const cpuAudio: ChatModel = {
                    id: ChatModelId.qwen3_vl_2b,
                    reasoning: false,
                    cpu: {
                        repo: `audio`,
                        file: `audio.gguf`,
                        mmproj: { file: `audio-mmproj.gguf`, audio: true },
                    },
                };
                assertEqual(supportsAudio(cpuAudio), true, `cpu audio`);
                const textOnlyGpu: ChatModel = {
                    id: ChatModelId.gemma4_e2b,
                    reasoning: false,
                    litert: {
                        repo: `text-only`,
                        file: `text-only.litertlm`,
                        vision: false,
                        audio: false,
                    },
                };
                assertEqual(
                    supportsImages(textOnlyGpu),
                    false,
                    `gpu text images`,
                );
                assertEqual(supportsAudio(textOnlyGpu), false, `gpu text audio`);
                const audioGpu: ChatModel = {
                    id: ChatModelId.gemma4_e2b,
                    reasoning: false,
                    litert: {
                        repo: `audio`,
                        file: `audio.litertlm`,
                        vision: false,
                        audio: true,
                    },
                };
                assertEqual(supportsImages(audioGpu), false, `gpu audio images`);
                assertEqual(supportsAudio(audioGpu), true, `gpu audio only`);
                assertEqual(findLlmModel(`missing`), undefined, `unknown model`);
            },
        },
        {
            name: `models/default`,
            run: async () => {
                const picked = await defaultLlmModel();
                assertEqual(
                    llmModels.some(model => model.id == picked),
                    true,
                    `default pick`,
                );
                assertEqual((await resolveLlmModel())?.id, picked, `resolved default`);
                assertEqual(
                    (await resolveLlmModel(ChatModelId.qwen3_vl_2b))?.id,
                    ChatModelId.qwen3_vl_2b,
                    `asked model`,
                );
                assertEqual(
                    await resolveLlmModel(`missing` as ChatModelId),
                    undefined,
                    `unknown model`,
                );
            },
        },
        {
            name: `models/mobile`,
            run: () => {
                assertEqual(
                    mobileDevice({
                        userAgent: `Mozilla/5.0 (Linux; Android 14)`,
                        maxTouchPoints: 5,
                    }),
                    true,
                    `android mobile`,
                );
                assertEqual(
                    mobileDevice({
                        userAgent: `Mozilla/5.0 (X11; Linux x86_64)`,
                        maxTouchPoints: 0,
                    }),
                    false,
                    `desktop`,
                );
                assertEqual(
                    mobileDevice({
                        userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)`,
                        maxTouchPoints: 5,
                    }),
                    true,
                    `ipad desktop agent`,
                );
                assertEqual(
                    mobileDevice({
                        userAgent: `Mozilla/5.0 (X11; Linux x86_64)`,
                        maxTouchPoints: 0,
                        userAgentData: { mobile: true },
                    }),
                    true,
                    `client hint wins`,
                );
                assertEqual(mobileCpuContextWindow, 4096, `mobile window`);
                const gemma = modelOf(ChatModelId.gemma4_e2b);
                assertEqual(
                    litertArtifact(gemma)?.file,
                    `gemma-4-E2B-it.litertlm`,
                    `desktop artifact`,
                );
                assertEqual(
                    litertArtifact(gemma, true)?.file,
                    `gemma-4-E2B-it-gpu.litertlm`,
                    `mobile artifact`,
                );
                assertEqual(
                    litertArtifact(gemma, true)?.vision,
                    false,
                    `mobile artifact vision`,
                );
                assertEqual(
                    supportsImages(gemma, false),
                    true,
                    `desktop images`,
                );
                assertEqual(supportsAudio(gemma, false), true, `desktop audio`);
            },
        },
        {
            name: `limits/defaults`,
            run: () => {
                const defaults = resolveLlmLimits();
                assertEqual(defaults.maxReplyTokens, defaultLlmLimits.maxReplyTokens, `reply`);
                assertEqual(defaults.promptCharBudget, 10000, `budget`);
                assertEqual(defaults.maxImages, 2, `images`);
                assertEqual(defaults.maxAudio, 1, `audio`);
                assertEqual(defaults.maxThreads, 6, `threads`);
                assertEqual(
                    defaults.maxReasoningTokens,
                    defaultLlmLimits.maxReasoningTokens,
                    `cpu reasoning`,
                );
                assertEqual(
                    resolveLlmLimits(undefined, true).maxReasoningTokens,
                    1200,
                    `gpu reasoning`,
                );
                assertEqual(
                    resolveLlmLimits({ maxReasoningTokens: 500 }, true).maxReasoningTokens,
                    500,
                    `gpu override`,
                );
                assertEqual(resolveLlmLimits({ maxThreads: 1 }).maxThreads, 1, `one thread`);
                assertEqual(resolveLlmLimits({ maxThreads: 8 }).maxThreads, 8, `eight threads`);
                assertEqual(resolveLlmLimits({ maxThreads: 0 }).maxThreads, 6, `bad threads`);
                const custom = resolveLlmLimits({
                    maxReplyTokens: 40,
                    promptCharBudget: 12.9,
                });
                assertEqual(custom.maxReplyTokens, 40, `custom reply`);
                assertEqual(custom.promptCharBudget, 12, `floored budget`);
                assertEqual(resolveLlmLimits({ maxImages: 3 }).maxImages, 3, `custom images`);
                assertEqual(resolveLlmLimits({ maxImages: 0 }).maxImages, 0, `zero images`);
                assertEqual(resolveLlmLimits({ maxAudio: 2 }).maxAudio, 2, `custom audio`);
                assertEqual(resolveLlmLimits({ maxAudio: 0 }).maxAudio, 0, `zero audio`);
                const invalid = resolveLlmLimits({
                    maxReplyTokens: 0,
                    maxThinkingTokens: -1,
                    maxImages: -1,
                    maxAudio: -1,
                    maxThreads: 0,
                });
                assertEqual(invalid.maxReplyTokens, defaultLlmLimits.maxReplyTokens, `bad reply`);
                assertEqual(
                    invalid.maxThinkingTokens,
                    defaultLlmLimits.maxThinkingTokens,
                    `bad thinking`,
                );
                assertEqual(invalid.maxImages, defaultLlmLimits.maxImages, `bad images`);
                assertEqual(invalid.maxAudio, defaultLlmLimits.maxAudio, `bad audio`);
                assertEqual(invalid.maxThreads, defaultLlmLimits.maxThreads, `bad threads`);
            },
        },
        {
            name: `limits/reply options`,
            run: () => {
                const plain = replyOptions(defaultLlmLimits, false);
                assertEqual(plain.max_tokens, defaultLlmLimits.maxReplyTokens, `plain tokens`);
                assertEqual(plain.stream, true, `stream`);
                assertEqual(plain.temperature, 0.7, `temperature`);
                const reasoning = replyOptions(
                    { ...defaultLlmLimits, maxReasoningTokens: 321 },
                    true,
                );
                assertEqual(reasoning.max_tokens, 321, `reasoning tokens`);
            },
        },
        {
            name: `prompt/system and alternation`,
            run: () => {
                const messages = buildMessages([
                    { role: LlmRole.system, content: `A` },
                    { role: LlmRole.user, content: `u1` },
                    { role: LlmRole.assistant, content: `a1` },
                    { role: LlmRole.system, content: `B` },
                    { role: LlmRole.user, content: `u2` },
                ]);
                assertEqual(messages.length, 4, `turn count`);
                assertEqual(messages[0].role, `system`, `system first`);
                assertEqual(messages[0].content, `A\n\nB`, `system order`);
                assertEqual(messages[1].content, `u1`, `user one`);
                assertEqual(messages[2].content, `a1`, `assistant one`);
                assertEqual(messages[3].content, `u2`, `user two`);
                const merged = buildMessages([
                    { role: LlmRole.user, content: `one` },
                    { role: LlmRole.user, content: `two` },
                ]);
                assertEqual(merged.length, 1, `merged length`);
                assertEqual(merged[0].content, `one\ntwo`, `merged text`);
                const leading = buildMessages([
                    { role: LlmRole.assistant, content: `a` },
                    { role: LlmRole.user, content: `u` },
                ]);
                assertEqual(leading.length, 1, `leading dropped`);
                assertEqual(leading[0].role, `user`, `starts with user`);
            },
        },
        {
            name: `prompt/clip and budgets`,
            run: () => {
                const clipped = buildMessages(
                    [{ role: LlmRole.user, content: `abcdef` }],
                    { ...defaultLlmLimits, maxContentLength: 3 },
                );
                assertEqual(clipped[0].content, `abc`, `content clip`);
                const budgeted = buildMessages(
                    [
                        { role: LlmRole.user, content: `12345` },
                        { role: LlmRole.user, content: `67890` },
                    ],
                    { ...defaultLlmLimits, promptCharBudget: 5 },
                );
                assertEqual(budgeted.length, 1, `budget length`);
                assertEqual(budgeted[0].content, `67890`, `budget tail`);
                assertEqual(buildMessages([]).length, 0, `empty prompt`);
                const systemOnly = buildMessages([
                    { role: LlmRole.system, content: `only` },
                ]);
                assertEqual(systemOnly.length, 1, `system only`);
                assertEqual(systemOnly[0].role, `system`, `system only role`);
            },
        },
        {
            name: `prompt/images`,
            run: async () => {
                const
                    image = `data:image/png;base64,QQ==`,
                    limits = { ...defaultLlmLimits, maxImages: 2 },
                    partsOf = (message?: EngineMessage) =>
                        (message?.content || []) as Array<{
                            type: string,
                            text?: string,
                            url?: string,
                        }>;
                const only = buildMessages([
                    { role: LlmRole.user, content: ``, images: [image] },
                ], limits);
                assertEqual(only.length, 1, `image only turn`);
                const onlyParts = partsOf(only[0]);
                assertEqual(onlyParts.length, 1, `image only parts`);
                assertEqual(onlyParts[0].type, `image`, `image only type`);
                assertEqual(onlyParts[0].url, image, `image only url`);
                const mixed = buildMessages([
                    { role: LlmRole.user, content: `look`, images: [image] },
                ], limits);
                const mixedParts = partsOf(mixed[0]);
                assertEqual(mixedParts.length, 2, `mixed parts`);
                assertEqual(mixedParts[0].text, `look`, `text first`);
                assertEqual(mixedParts[1].type, `image`, `image second`);
                const capped = buildMessages([
                    { role: LlmRole.user, content: `one`, images: [`a`, `b`] },
                    { role: LlmRole.assistant, content: `ok` },
                    { role: LlmRole.user, content: `two`, images: [`c`] },
                ], limits);
                assertEqual(capped.length, 3, `capped turns`);
                const olderParts = partsOf(capped[0]);
                assertEqual(
                    olderParts.filter(part => part.type == `image`).length,
                    1,
                    `older image cap`,
                );
                const newestParts = partsOf(capped[2]);
                assertEqual(newestParts[1].url, `c`, `newest image`);
                const zero = buildMessages([
                    { role: LlmRole.user, content: `hi`, images: [image] },
                ], { ...limits, maxImages: 0 });
                assertEqual(typeof zero[0].content, `string`, `zero images`);
                const systemImages = buildMessages([
                    { role: LlmRole.system, content: `sys`, images: [image] },
                    { role: LlmRole.user, content: `hi` },
                ], limits);
                assertEqual(systemImages[0].content, `sys`, `system image ignored`);
                const assistantImages = buildMessages([
                    { role: LlmRole.user, content: `hi` },
                    { role: LlmRole.assistant, content: `ok`, images: [image] },
                ], limits);
                assertEqual(assistantImages[1].content, `ok`, `assistant image ignored`);
                const
                    buffer = await contentBuffer(image),
                    wllama = await toWllamaMessages(mixed),
                    wllamaParts = wllama[0].content as Array<{
                        type: string,
                        text?: string,
                        data?: ArrayBuffer,
                    }>,
                    litert = await toLitertMessages(mixed),
                    litertParts = litert[0].content as Array<{
                        type: string,
                        text?: string,
                        data?: ArrayBuffer,
                    }>;
                assertEqual(new Uint8Array(buffer)[0], 65, `decoded image`);
                assertEqual(wllamaParts[0].type, `text`, `wllama text`);
                assertEqual(wllamaParts[1].type, `image`, `wllama image`);
                assertEqual(wllamaParts[1].data?.byteLength, 1, `wllama bytes`);
                assertEqual(litertParts[0].text, `look`, `litert text`);
                assertEqual(litertParts[1].type, `image`, `litert image`);
                assertEqual(litertParts[1].data?.byteLength, 1, `litert bytes`);
                const
                    preface = await toLitertMessages([mixed[0]], false),
                    prefaceParts = preface[0].content as Array<{
                        type: string,
                        text?: string,
                    }>;
                assertEqual(prefaceParts[1].type, `text`, `preface text`);
                assertEqual(prefaceParts[1].text, `[image]`, `preface note`);
                assertEqual(
                    modelUrl(`repo`, `file.gguf`),
                    `https://huggingface.co/repo/resolve/main/file.gguf`,
                    `model url`,
                );
                assertEqual(hasImages(mixed), true, `has images`);
                assertEqual(
                    hasImages([{ role: LlmRole.user, content: `plain` }]),
                    false,
                    `no images`,
                );
            },
        },
        {
            name: `prompt/audio`,
            run: async () => {
                const
                    audio = `data:audio/wav;base64,QQ==`,
                    image = `data:image/png;base64,QQ==`,
                    limits = { ...defaultLlmLimits, maxAudio: 2 },
                    partsOf = (message?: EngineMessage): Array<{
                        type: string,
                        text?: string,
                        url?: string,
                    }> => typeof message?.content == `string`
                        ? message.content
                            ? [{ type: `text`, text: message.content }]
                            : []
                        : message?.content || [];
                const only = buildMessages([
                    { role: LlmRole.user, content: ``, audio: [audio] },
                ], limits);
                assertEqual(only.length, 1, `audio only turn`);
                const onlyParts = partsOf(only[0]);
                assertEqual(onlyParts.length, 1, `audio only parts`);
                assertEqual(onlyParts[0].type, `audio`, `audio only type`);
                assertEqual(onlyParts[0].url, audio, `audio only url`);
                const mixed = buildMessages([
                    {
                        role: LlmRole.user,
                        content: `hear`,
                        images: [image],
                        audio: [audio],
                    },
                ], limits);
                const mixedParts = partsOf(mixed[0]);
                assertEqual(mixedParts.length, 3, `mixed media parts`);
                assertEqual(mixedParts[0].text, `hear`, `audio text first`);
                assertEqual(mixedParts[1].type, `image`, `audio image second`);
                assertEqual(mixedParts[2].type, `audio`, `audio third`);
                const capped = buildMessages([
                    { role: LlmRole.user, content: `one`, audio: [`a`, `b`] },
                    { role: LlmRole.assistant, content: `ok` },
                    { role: LlmRole.user, content: `two`, audio: [`c`] },
                ], { ...limits, maxAudio: 1 });
                assertEqual(capped.length, 3, `audio capped turns`);
                assertEqual(
                    partsOf(capped[0])
                        .filter(part => part.type == `audio`).length,
                    0,
                    `older audio cap`,
                );
                const newestParts = partsOf(capped[2]);
                assertEqual(newestParts[1].url, `c`, `newest audio`);
                const zero = buildMessages([
                    { role: LlmRole.user, content: `hi`, audio: [audio] },
                ], { ...limits, maxAudio: 0 });
                assertEqual(typeof zero[0].content, `string`, `zero audio`);
                const systemAudio = buildMessages([
                    { role: LlmRole.system, content: `sys`, audio: [audio] },
                    { role: LlmRole.user, content: `hi` },
                ], limits);
                assertEqual(systemAudio[0].content, `sys`, `system audio ignored`);
                const assistantAudio = buildMessages([
                    { role: LlmRole.user, content: `hi` },
                    { role: LlmRole.assistant, content: `ok`, audio: [audio] },
                ], limits);
                assertEqual(
                    assistantAudio[1].content,
                    `ok`,
                    `assistant audio ignored`,
                );
                const
                    buffer = await contentBuffer(audio),
                    wllama = await toWllamaMessages(mixed),
                    wllamaParts = wllama[0].content as Array<{
                        type: string,
                        text?: string,
                        data?: ArrayBuffer,
                    }>,
                    litert = await toLitertMessages(mixed),
                    litertParts = litert[0].content as Array<{
                        type: string,
                        text?: string,
                        data?: ArrayBuffer,
                    }>;
                assertEqual(new Uint8Array(buffer)[0], 65, `decoded audio`);
                assertEqual(wllamaParts[2].type, `audio`, `wllama audio`);
                assertEqual(wllamaParts[2].data?.byteLength, 1, `wllama audio bytes`);
                assertEqual(litertParts[2].type, `audio`, `litert audio`);
                assertEqual(litertParts[2].data?.byteLength, 1, `litert audio bytes`);
                const
                    preface = await toLitertMessages([mixed[0]], false),
                    prefaceParts = preface[0].content as Array<{
                        type: string,
                        text?: string,
                    }>;
                assertEqual(prefaceParts[1].text, `[image]`, `preface image note`);
                assertEqual(prefaceParts[2].text, `[audio]`, `preface audio note`);
                assertEqual(hasAudio(mixed), true, `has audio`);
                assertEqual(
                    hasAudio([{ role: LlmRole.user, content: `plain` }]),
                    false,
                    `no audio`,
                );
            },
        },
        {
            name: `prompt/history`,
            run: () => {
                const
                    system: EngineMessage = { role: LlmRole.system, content: `sys` },
                    user = (text: string): EngineMessage => ({
                        role: LlmRole.user,
                        content: text,
                    }),
                    assistant = (text: string): EngineMessage => ({
                        role: LlmRole.assistant,
                        content: text,
                    }),
                    first = [system, user(`one`), assistant(`first`)],
                    full = [...first, user(`two`), assistant(`second`)];
                assertEqual(continuesHistory(first, first), true, `same history`);
                assertEqual(continuesHistory(full, first), false, `old prefix`);
                assertEqual(
                    continuesHistory(full, [system, user(`two`), assistant(`second`)]),
                    true,
                    `trimmed history`,
                );
                assertEqual(
                    continuesHistory(full, [system, user(`edited`), assistant(`second`)]),
                    false,
                    `edited turn`,
                );
                assertEqual(
                    continuesHistory(full, [{ role: LlmRole.system, content: `new` }]),
                    false,
                    `changed system`,
                );
                assertEqual(continuesHistory(full, [system]), false, `empty turns`);
                assertEqual(continuesHistory([], []), false, `empty history`);
                const
                    left = [user(`look`)],
                    right = [{
                        role: LlmRole.user,
                        content: [
                            { type: `text`, text: `look` },
                            { type: `image`, url: `one` },
                        ],
                    }] as EngineMessage[];
                assertEqual(continuesHistory(left, right), false, `image added`);
                const audioRight = [{
                    role: LlmRole.user,
                    content: [
                        { type: `text`, text: `hear` },
                        { type: `audio`, url: `one` },
                    ],
                }] as EngineMessage[];
                assertEqual(
                    continuesHistory([user(`hear`)], audioRight),
                    false,
                    `audio added`,
                );
            },
        },
        {
            name: `litert/reuse`,
            run: async () => {
                interface FakeConversation {
                    config?: unknown,
                    prompts: unknown[],
                    deleted: number,
                }
                const
                    conversations: FakeConversation[] = [],
                    streamOf = (text: string) => new ReadableStream({
                        start(controller) {
                            controller.enqueue({
                                role: `assistant`,
                                content: [{ type: `text`, text }],
                            });
                            controller.close();
                        },
                    }),
                    engine = {
                        createConversation: async (config?: unknown) => {
                            const record: FakeConversation = {
                                config,
                                prompts: [],
                                deleted: 0,
                            };
                            conversations.push(record);
                            return {
                                sendMessageStreaming: (prompt: unknown) => {
                                    record.prompts.push(prompt);
                                    return streamOf(`reply ${conversations.length}`);
                                },
                                cancel: () => { },
                                delete: async () => { record.deleted += 1; },
                            };
                        },
                    } as unknown as LitertEngine,
                    mod = {
                        SamplerType: { TOP_K: 0 },
                    } as unknown as LitertModule,
                    session: LitertSession = {
                        sent: [],
                        reasoning: false,
                        maxTokens: 0,
                    },
                    params: EngineChatParams = {
                        messages: [],
                        limits: defaultLlmLimits,
                        reasoning: false,
                        onReason: () => { },
                        onText: () => { },
                    },
                    run = async (messages: EngineMessage[]) => {
                        let text = ``;
                        for await (const chunk of streamLitert({
                            engine,
                            mod,
                            params,
                            messages,
                            session,
                        }))
                            text += chunk.choices?.[0]?.delta?.content || ``;
                        return text;
                    },
                    system: EngineMessage = {
                        role: LlmRole.system,
                        content: `sys`,
                    },
                    user = (text: string): EngineMessage => ({
                        role: LlmRole.user,
                        content: text,
                    }),
                    assistant = (text: string): EngineMessage => ({
                        role: LlmRole.assistant,
                        content: text,
                    });
                assertEqual(await run([system, user(`one`)]), `reply 1`, `first reply`);
                assertEqual(conversations.length, 1, `first conversation`);
                assertEqual(session.sent.length, 3, `first history`);
                assertEqual(
                    (session.sent[2] as { content: string }).content,
                    `reply 1`,
                    `assistant turn`,
                );
                assertEqual(
                    await run([system, user(`one`), assistant(`reply 1`), user(`two`)]),
                    `reply 1`,
                    `second reply`,
                );
                assertEqual(conversations.length, 1, `reused conversation`);
                assertEqual(conversations[0].prompts.length, 2, `two prompts`);
                assertEqual(
                    (conversations[0].prompts[1] as { content: string }).content,
                    `two`,
                    `second prompt`,
                );
                assertEqual(
                    await run([
                        system,
                        user(`edited`),
                        assistant(`reply 1`),
                        user(`two`),
                    ]),
                    `reply 2`,
                    `third reply`,
                );
                assertEqual(conversations.length, 2, `changed history`);
                assertEqual(conversations[0].deleted, 0, `no delete`);
                assertEqual(conversations[1].deleted, 0, `no new delete`);
            },
        },
        {
            name: `litert/vision budget`,
            run: () => {
                const
                    model = modelOf(ChatModelId.gemma4_e2b),
                    mod = { Backend: { GPU: 3, CPU: 1 } } as unknown as LitertModule,
                    source = new ReadableStream<Uint8Array>(),
                    vision = litertSettings({
                        model,
                        limits: defaultLlmLimits,
                        source,
                        mod,
                    }),
                    text = litertSettings({
                        model: {
                            id: ChatModelId.gemma4_e2b,
                            reasoning: false,
                            litert: {
                                repo: `text-only`,
                                file: `text-only.litertlm`,
                                vision: false,
                                audio: false,
                            },
                        },
                        limits: defaultLlmLimits,
                        source,
                        mod,
                    }),
                    audio = litertSettings({
                        model: {
                            id: ChatModelId.gemma4_e2b,
                            reasoning: false,
                            litert: {
                                repo: `audio-only`,
                                file: `audio-only.litertlm`,
                                vision: false,
                                audio: true,
                            },
                        },
                        limits: defaultLlmLimits,
                        source,
                        mod,
                    });
                assertEqual(visionTokens, 70, `smallest budget`);
                assertEqual(vision.maxVisionTokensPerImage, 70, `max tokens`);
                assertEqual(vision.minVisionTokensPerImage, 70, `min tokens`);
                assertEqual(vision.visionBackend, 3, `vision backend`);
                assertEqual(vision.audioBackend, 1, `audio backend`);
                assertEqual(
                    vision.mainExecutorSettings?.maxNumImages,
                    defaultLlmLimits.maxImages,
                    `max images`,
                );
                assertEqual(text.visionBackend, undefined, `no text vision`);
                assertEqual(text.maxVisionTokensPerImage, undefined, `no text tokens`);
                assertEqual(text.minVisionTokensPerImage, undefined, `no text min`);
                assertEqual(text.audioBackend, undefined, `no text audio`);
                assertEqual(audio.visionBackend, undefined, `no audio vision`);
                assertEqual(audio.audioBackend, 1, `audio only backend`);
            },
        },
        {
            name: `stream/stall`,
            run: async () => {
                const
                    model = modelOf(ChatModelId.gemma4_e2b),
                    silent = async function* () {
                        await new Promise(() => { });
                    },
                    first = await streamReply({
                        model,
                        onReason: () => { },
                        onText: () => { },
                        start: async () => silent(),
                        stopped: () => false,
                        firstTimeoutMs: 20,
                        idleTimeoutMs: 20,
                    }).then(
                        () => ``,
                        (error: Error) => error.message,
                    ),
                    partial = async function* () {
                        yield { choices: [{ delta: { content: `hi` } }] };
                        await new Promise(() => { });
                    };
                let stalled = 0;
                const text = await streamReply({
                    model,
                    onReason: () => { },
                    onText: () => { },
                    start: async () => partial(),
                    stopped: () => false,
                    firstTimeoutMs: 20,
                    idleTimeoutMs: 20,
                    onStall: () => { stalled += 1; },
                });
                assertEqual(first, `Model did not reply`, `first stall`);
                assertEqual(text, `hi`, `partial reply`);
                assertEqual(stalled, 1, `stall kept text`);
            },
        },
        {
            name: `think/splitter`,
            run: () => {
                const
                    reasoned: string[] = [],
                    text: string[] = [],
                    splitter = createThinkSplitter(
                        value => reasoned.push(value),
                        value => text.push(value),
                    );
                splitter.feed(`hello <|channel>thought\nwhy<channel|>world`);
                splitter.flush();
                assertEqual(text.join(``), `hello world`, `visible text`);
                assertEqual(reasoned.join(``), `why`, `reasoning text`);
                const
                    partialReason: string[] = [],
                    partialText: string[] = [],
                    partial = createThinkSplitter(
                        value => partialReason.push(value),
                        value => partialText.push(value),
                    );
                partial.feed(`hi <|chan`);
                assertEqual(partialText.join(``), `hi `, `held partial`);
                partial.feed(`nel>thought\nx`);
                partial.flush();
                assertEqual(partialText.join(``), `hi `, `held no leak`);
                assertEqual(partialReason.join(``), `x`, `held reasoning`);
            },
        },
        {
            name: `stream/reply`,
            run: async () => {
                const
                    model = modelOf(ChatModelId.qwen3_vl_2b),
                    reasoned: string[] = [],
                    text: string[] = [],
                    result = await streamReply({
                        model,
                        onReason: value => reasoned.push(value),
                        onText: value => text.push(value),
                        start: async () => streamOf(
                            { choices: [{ delta: { reasoning_content: `why` } }] },
                            { choices: [{ delta: { content: `hello ` } }] },
                            {
                                choices: [{
                                    delta: { content: `world` },
                                    finish_reason: `stop`,
                                }],
                            },
                        ),
                        stopped: () => false,
                    });
                assertEqual(result, `hello world`, `reply text`);
                assertEqual(reasoned.join(``), `why`, `reasoning deltas`);
                assertEqual(text.join(``), `hello world`, `text deltas`);
                const inline = await streamReply({
                    model,
                    onReason: () => { },
                    onText: () => { },
                    start: async () => streamOf({
                        choices: [{
                            delta: { content: `<|channel>thought\nwhy<channel|>answer` },
                        }],
                    }),
                    stopped: () => false,
                });
                assertEqual(inline, `answer`, `inline reasoning`);
                const stopped = await streamReply({
                    model,
                    onReason: () => { },
                    onText: () => { },
                    start: async () => streamOf({
                        choices: [{ delta: { content: `hidden` } }],
                    }),
                    stopped: () => true,
                });
                assertEqual(stopped, undefined, `stopped reply`);
                const failed = await streamReply({
                    model,
                    onReason: () => { },
                    onText: () => { },
                    start: async () => { throw new Error(`boom`); },
                    stopped: () => false,
                });
                assertEqual(failed, undefined, `failed reply`);
                const
                    sent: EngineMessage[] = [],
                    built = await runEngineChat({
                        model,
                        params: {
                            messages: [
                                { role: LlmRole.system, content: `sys` },
                                userMessage(`hi`),
                            ],
                            limits: defaultLlmLimits,
                            reasoning: false,
                            onReason: () => { },
                            onText: () => { },
                        },
                        stopped: () => false,
                        start: async messages => {
                            sent.push(...messages);
                            return streamOf({
                                choices: [{ delta: { content: `ok` } }],
                            });
                        },
                    });
                assertEqual(built, `ok`, `engine run`);
                assertEqual(sent[0].role, `system`, `engine system`);
                assertEqual(sent[1].content, `hi`, `engine user`);
            },
        },
        {
            name: `speed/stream`,
            run: async () => {
                const
                    model = modelOf(ChatModelId.qwen3_vl_2b),
                    speeds: number[] = [],
                    result = await streamReply({
                        model,
                        onReason: () => { },
                        onText: () => { },
                        onSpeed: value => speeds.push(value),
                        start: async () => (async function* () {
                            yield { choices: [{ delta: { reasoning_content: `why` } }] };
                            await sleep(10);
                            yield { choices: [{ delta: { content: `hel` } }] };
                            await sleep(10);
                            yield { choices: [{ delta: { content: `lo` } }] };
                        })(),
                        stopped: () => false,
                    });
                assertEqual(result, `hello`, `speed reply`);
                assertEqual(speeds.length, 2, `speed updates`);
                assert(
                    speeds.every(value => Number.isFinite(value) && value > 0),
                    `positive speed`,
                );
                const
                    silent: number[] = [],
                    single = await streamReply({
                        model,
                        onReason: () => { },
                        onText: () => { },
                        onSpeed: value => silent.push(value),
                        start: async () => streamOf({
                            choices: [{ delta: { content: `one` } }],
                        }),
                        stopped: () => false,
                    });
                assertEqual(single, `one`, `single reply`);
                assertEqual(silent.length, 0, `no speed for one token`);
            },
        },
        {
            name: `runtime/load and reuse`,
            run: async () => {
                const
                    { runtime, calls, models } = runtimeWith(),
                    progress: Array<{ percent: number, phase: LlmPhase }> = [],
                    loaded = await runtime.load({
                        model: modelOf(ChatModelId.qwen3_vl_2b),
                        limits: resolveLlmLimits(),
                        onProgress: (percent, phase) => progress.push({ percent, phase }),
                    });
                assertEqual(loaded, true, `loaded`);
                assertEqual(runtime.ready(), true, `ready`);
                assertEqual(runtime.loading(), false, `not loading`);
                assertEqual(runtime.status(), LlmStatus.ready, `ready status`);
                assertEqual(runtime.backend(), LlmBackend.cpu, `backend`);
                assertEqual(runtime.error(), undefined, `no load error`);
                assertEqual(calls.start, 1, `started once`);
                assertEqual(models[0].id, ChatModelId.qwen3_vl_2b, `loaded model`);
                assert(progress.length >= 2, `progress events`);
                assertEqual(progress[0].phase, LlmPhase.download, `download phase`);
                assertEqual(progress[progress.length - 1].phase, LlmPhase.load, `load phase`);
                assertEqual(progress[progress.length - 1].percent, 1, `full progress`);
                const reused = await runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                assertEqual(reused, true, `reused`);
                assertEqual(calls.start, 1, `reuse skips start`);
            },
        },
        {
            name: `runtime/gpu model`,
            run: async () => {
                const
                    { runtime, calls, models } = runtimeWith({
                        backend: LlmBackend.gpu,
                    }),
                    progress: number[] = [],
                    loaded = await runtime.load({
                        model: modelOf(ChatModelId.gemma4_e2b),
                        limits: resolveLlmLimits(),
                        onProgress: value => progress.push(value),
                    });
                assertEqual(loaded, true, `gpu loaded`);
                assertEqual(runtime.ready(), true, `gpu ready`);
                assertEqual(runtime.backend(), LlmBackend.gpu, `gpu backend`);
                assertEqual(calls.start, 1, `gpu started`);
                assertEqual(models[0].id, ChatModelId.gemma4_e2b, `gpu model`);
                assertEqual(progress[progress.length - 1], 1, `gpu progress`);
                const
                    reasoned: string[] = [],
                    text: string[] = [],
                    result = await runtime.chat({
                        messages: [userMessage(`hi`)],
                        limits: resolveLlmLimits(),
                        reasoning: false,
                        onReason: value => reasoned.push(value),
                        onText: value => text.push(value),
                    });
                assertEqual(result, `reply`, `gpu reply`);
                assertEqual(text.join(``), `reply`, `gpu text`);
            },
        },
        {
            name: `runtime/backend selection`,
            run: async () => {
                const cpuOnly = runtimeWith({ backend: LlmBackend.cpu });
                const cpuLoaded = await cpuOnly.runtime.load({
                    model: modelOf(ChatModelId.gemma4_e2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                assertEqual(cpuLoaded, false, `gpu model on cpu`);
                assertEqual(cpuOnly.calls.start, 0, `no cpu start`);
                const gpuOnly = runtimeWith({ backend: LlmBackend.gpu });
                const gpuLoaded = await gpuOnly.runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                assertEqual(gpuLoaded, false, `cpu model on gpu`);
                assertEqual(gpuOnly.calls.start, 0, `no gpu start`);
            },
        },
        {
            name: `runtime/chat budgets`,
            run: async () => {
                const
                    { runtime, requests } = runtimeWith({
                        chatText: `hello`,
                        thinkingText: `why`,
                    }),
                    reasoned: string[] = [],
                    text: string[] = [];
                await runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                const result = await runtime.chat({
                    messages: [userMessage(`hi`)],
                    limits: { ...defaultLlmLimits, maxReplyTokens: 12 },
                    reasoning: true,
                    onReason: value => reasoned.push(value),
                    onText: value => text.push(value),
                });
                assertEqual(result, `hello`, `chat result`);
                assertEqual(requests.length, 1, `one chat`);
                assertEqual(requests[0].limits.maxReplyTokens, 12, `call limits`);
                assertEqual(requests[0].reasoning, true, `call reasoning`);
                assertEqual(reasoned.join(``), `why`, `thinking stream`);
                assertEqual(text.join(``), `hello`, `reply stream`);
            },
        },
        {
            name: `runtime/join same load`,
            run: async () => {
                const
                    gate = deferred(),
                    { runtime, calls } = runtimeWith({ loadGate: gate.promise }),
                    progress: number[] = [],
                    model = modelOf(ChatModelId.qwen3_vl_2b),
                    first = runtime.load({
                        model,
                        limits: resolveLlmLimits(),
                        onProgress: value => progress.push(value),
                    }),
                    second = runtime.load({
                        model,
                        limits: resolveLlmLimits(),
                        onProgress: value => progress.push(value),
                    });
                await sleep(0);
                await waitFor(() => calls.start == 1, `load started`);
                assertEqual(calls.start, 1, `joined load`);
                gate.resolve();
                assertEqual(await first, true, `first load`);
                assertEqual(await second, true, `second load`);
                assertEqual(calls.start, 1, `still one start`);
            },
        },
        {
            name: `preload/chat joins in-flight load`,
            run: async () => {
                const
                    gate = deferred(),
                    { runtime, calls } = runtimeWith({ loadGate: gate.promise }),
                    replies: string[] = [],
                    preload = createPreloadOn(runtime)({
                        model: ChatModelId.qwen3_vl_2b,
                        onStatus: () => { },
                    });
                await waitFor(() => calls.start == 1, `preload started`);
                createChatOn(runtime)({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`hi`)],
                    onResponse: value => replies.push(value),
                });
                await sleep(20);
                assertEqual(calls.start, 1, `chat joins download`);
                gate.resolve();
                assertEqual(await preload, true, `preload done`);
                await waitFor(() => replies[replies.length - 1] == `reply`, `chat reply`);
                assertEqual(calls.start, 1, `one download`);
            },
        },
        {
            name: `runtime/joiner cancel keeps load`,
            run: async () => {
                const
                    gate = deferred(),
                    { runtime, calls } = runtimeWith({ loadGate: gate.promise }),
                    model = modelOf(ChatModelId.qwen3_vl_2b),
                    limits = resolveLlmLimits(),
                    controller = new AbortController(),
                    owner = runtime.load({
                        model,
                        limits,
                        onProgress: () => { },
                    }),
                    joiner = runtime.load({
                        model,
                        limits,
                        signal: controller.signal,
                        onProgress: () => { },
                    });
                await waitFor(() => calls.start == 1, `load started`);
                let left = false;
                void joiner.then(() => { left = true; });
                controller.abort();
                await sleep(20);
                assertEqual(left, true, `joiner left`);
                assertEqual(calls.start, 1, `load kept`);
                gate.resolve();
                assertEqual(await owner, true, `owner loaded`);
                assertEqual(calls.start, 1, `still one download`);
                assertEqual(runtime.ready(), true, `ready`);
            },
        },
        {
            name: `runtime/cancel load`,
            run: async () => {
                const
                    gate = deferred(),
                    { runtime } = runtimeWith({ loadGate: gate.promise }),
                    model = modelOf(ChatModelId.qwen3_vl_2b),
                    controller = new AbortController(),
                    loading = runtime.load({
                        model,
                        limits: resolveLlmLimits(),
                        signal: controller.signal,
                        onProgress: () => { },
                    });
                await sleep(0);
                controller.abort();
                gate.resolve();
                assertEqual(await loading, false, `cancelled load`);
                assertEqual(runtime.status(), LlmStatus.idle, `idle after cancel`);
            },
        },
        {
            name: `preload/chat cancel keeps download`,
            run: async () => {
                const
                    gate = deferred(),
                    { runtime, calls } = runtimeWith({ loadGate: gate.promise }),
                    preload = createPreloadOn(runtime)({
                        model: ChatModelId.qwen3_vl_2b,
                        onStatus: () => { },
                    });
                await waitFor(() => calls.start == 1, `preload started`);
                const cancel = createChatOn(runtime)({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`hi`)],
                    onResponse: () => { },
                });
                await sleep(10);
                cancel();
                await sleep(10);
                gate.resolve();
                assertEqual(await preload, true, `preload finished`);
                assertEqual(calls.start, 1, `one download`);
                assertEqual(runtime.ready(), true, `model ready`);
                assertEqual(calls.chat, 0, `no chat after cancel`);
            },
        },
        {
            name: `runtime/unsupported`,
            run: async () => {
                const
                    fake = createFakeEngine({ backend: LlmBackend.cpu }),
                    runtime = createRuntime({
                        engines: { cpu: fake.engine },
                        backend: LlmBackend.none,
                    }),
                    loaded = await runtime.load({
                        model: modelOf(ChatModelId.qwen3_vl_2b),
                        limits: resolveLlmLimits(),
                        onProgress: () => { },
                    });
                assertEqual(loaded, false, `unsupported load`);
                assertEqual(runtime.status(), LlmStatus.unsupported, `unsupported status`);
                assertEqual(runtime.error(), `Model is not supported on this device`,
                    `unsupported error`);
                assertEqual(runtime.ready(), false, `not ready`);
                assertEqual(fake.calls.start, 0, `no engine start`);
            },
        },
        {
            name: `runtime/start failure`,
            run: async () => {
                const { runtime, calls } = runtimeWith({ failStart: true });
                const loaded = await runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                assertEqual(loaded, false, `failed load`);
                assertEqual(runtime.status(), LlmStatus.error, `error status`);
                assertEqual(runtime.error(), `start failed`, `load error`);
                assertEqual(calls.purge, 0, `failure keeps the stored parts`);
            },
        },
        {
            name: `runtime/unload`,
            run: async () => {
                const { runtime, calls } = runtimeWith();
                await runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                await runtime.unload();
                assertEqual(runtime.status(), LlmStatus.idle, `idle after unload`);
                assertEqual(runtime.ready(), false, `not ready after unload`);
                assertEqual(calls.unload, 1, `engine unloaded`);
            },
        },
        {
            name: `runtime/serialized chat`,
            run: async () => {
                const
                    gate = deferred(),
                    { runtime, calls } = runtimeWith({ chatGate: gate.promise }),
                    limits = resolveLlmLimits();
                await runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits,
                    onProgress: () => { },
                });
                const params = {
                    messages: [userMessage(`hi`)],
                    limits,
                    reasoning: false,
                    onReason: () => { },
                    onText: () => { },
                };
                const first = runtime.chat(params);
                const second = runtime.chat(params);
                await sleep(0);
                assertEqual(calls.chat, 1, `one chat at a time`);
                gate.resolve();
                await first;
                await second;
                assertEqual(calls.chat, 2, `second chat ran`);
            },
        },
        {
            name: `preload/load and reuse`,
            run: async () => {
                const
                    { runtime, calls, limits } = runtimeWith(),
                    preload = createPreloadOn(runtime),
                    statuses: ChatStatusSnapshot[] = [],
                    loaded = await preload({
                        model: ChatModelId.qwen3_vl_2b,
                        limits: { maxThreads: 1 },
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(loaded, true, `preloaded`);
                assertEqual(calls.start, 1, `started once`);
                assertEqual(limits[0].maxThreads, 1, `preload limits`);
                assertEqual(
                    statuses.some(value => value.loading),
                    true,
                    `loading emitted`,
                );
                const last = statuses[statuses.length - 1];
                assertEqual(last.ready, true, `ready end`);
                assertEqual(last.percent, 100, `percent end`);
                assertEqual(last.phase, LlmPhase.load, `load end`);
                assertEqual(last.error, undefined, `no error`);
                createChatOn(runtime)({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`hi`)],
                    onResponse: () => { },
                });
                await waitFor(() => calls.chat == 1, `chat after preload`);
                assertEqual(calls.start, 1, `no second load`);
                statuses.length = 0;
                const reused = await preload({
                    model: ChatModelId.qwen3_vl_2b,
                    onStatus: value => statuses.push(value),
                });
                assertEqual(reused, true, `reused preload`);
                assertEqual(calls.start, 1, `reuse skips start`);
                assertEqual(statuses.length, 1, `one ready status`);
                assertEqual(statuses[0].ready, true, `reuse ready`);
            },
        },
        {
            name: `preload/gpu model`,
            run: async () => {
                const
                    { runtime, calls } = runtimeWith({
                        backend: LlmBackend.gpu,
                    }),
                    statuses: ChatStatusSnapshot[] = [],
                    loaded = await createPreloadOn(runtime)({
                        model: ChatModelId.gemma4_e2b,
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(loaded, true, `gpu preloaded`);
                assertEqual(calls.start, 1, `gpu start`);
                const last = statuses[statuses.length - 1];
                assertEqual(last.ready, true, `gpu ready`);
                assertEqual(last.backend, LlmBackend.gpu, `gpu backend`);
                assertEqual(last.supportsImages, true, `gpu images`);
                assertEqual(last.supportsAudio, true, `gpu audio`);
                assertEqual(last.error, undefined, `gpu no error`);
            },
        },
        {
            name: `preload/unknown model`,
            run: async () => {
                const
                    { runtime, calls } = runtimeWith(),
                    statuses: ChatStatusSnapshot[] = [],
                    loaded = await createPreloadOn(runtime)({
                        model: `missing` as ChatModelId,
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(loaded, false, `not preloaded`);
                assertEqual(calls.start, 0, `no start`);
                assertEqual(statuses[statuses.length - 1].error, `Unknown model`, `error`);
            },
        },
        {
            name: `preload/start failure`,
            run: async () => {
                const
                    { runtime, calls } = runtimeWith({ failStart: true }),
                    statuses: ChatStatusSnapshot[] = [],
                    loaded = await createPreloadOn(runtime)({
                        model: ChatModelId.qwen3_vl_2b,
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(loaded, false, `failed preload`);
                assertEqual(calls.start, 1, `one start`);
                const last = statuses[statuses.length - 1];
                assertEqual(last.status, LlmStatus.error, `error status`);
                assertEqual(last.error, `start failed`, `error`);
            },
        },
        {
            name: `preload/unsupported`,
            run: async () => {
                const
                    fake = createFakeEngine({ backend: LlmBackend.cpu }),
                    runtime = createRuntime({
                        engines: { cpu: fake.engine },
                        backend: LlmBackend.none,
                    }),
                    statuses: ChatStatusSnapshot[] = [],
                    loaded = await createPreloadOn(runtime)({
                        model: ChatModelId.qwen3_vl_2b,
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(loaded, false, `unsupported preload`);
                assertEqual(fake.calls.start, 0, `no start`);
                const last = statuses[statuses.length - 1];
                assertEqual(last.status, LlmStatus.unsupported, `unsupported`);
                assertEqual(last.availability, ChatStatus.offline, `offline`);
            },
        },
        {
            name: `preload/public entry`,
            run: async () => {
                const
                    statuses: ChatStatusSnapshot[] = [],
                    loaded = await preloadModel({
                        model: `missing` as ChatModelId,
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(loaded, false, `public preload`);
                assertEqual(statuses.length, 1, `one status`);
                assertEqual(statuses[0].error, `Unknown model`, `error`);
            },
        },
        {
            name: `chat/status and stream`,
            run: async () => {
                const
                    statuses: ChatStatusSnapshot[] = [],
                    reasoned: string[] = [],
                    replies: string[] = [],
                    { chat } = chatWith({
                        chatText: `hello`,
                        thinkingText: `why`,
                    });
                const cancel = chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`hi`)],
                    reasoning: true,
                    onThinking: value => reasoned.push(value),
                    onResponse: value => replies.push(value),
                    onStatus: value => statuses.push(value),
                });
                assertEqual(typeof cancel, `function`, `cancel handle`);
                await sleep(20);
                assertEqual(statuses[0].requesting, false, `idle start`);
                assertEqual(statuses[0].ready, false, `not ready start`);
                assertEqual(statuses[0].availability, ChatStatus.away, `away start`);
                assertEqual(
                    statuses.some(value => value.requesting),
                    true,
                    `requesting emitted`,
                );
                assertEqual(statuses[statuses.length - 1].requesting, false, `idle end`);
                assertEqual(statuses[statuses.length - 1].ready, true, `ready end`);
                assertEqual(statuses[statuses.length - 1].percent, 100, `percent end`);
                assertEqual(statuses[statuses.length - 1].error, undefined, `no error`);
                assertEqual(replies[replies.length - 1], `hello`, `accumulated reply`);
                assertEqual(reasoned[reasoned.length - 1], `why`, `accumulated thinking`);
            },
        },
        {
            name: `speed/opt-in`,
            run: async () => {
                const
                    speeds: number[] = [],
                    { chat } = chatWith({
                        chatImpl: async params => {
                            params.onSpeed?.(12.5);
                            params.onText(`ok`);
                            return `ok`;
                        },
                    });
                chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`hi`)],
                    onResponse: () => { },
                    onSpeed: value => speeds.push(value),
                });
                await waitFor(() => speeds.length == 1, `speed callback`);
                assertEqual(speeds[0], 12.5, `speed forwarded`);
            },
        },
        {
            name: `chat/text and images`,
            run: async () => {
                const
                    image = `data:image/png;base64,QQ==`,
                    vision = chatWith({ chatText: `seen` }),
                    visionStatuses: ChatStatusSnapshot[] = [],
                    replies: string[] = [];
                vision.chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [{ role: LlmRole.user, content: `what`, images: [image] }],
                    onResponse: value => replies.push(value),
                    onStatus: value => visionStatuses.push(value),
                });
                await waitFor(() => vision.requests.length == 1, `vision chat`);
                assertEqual(vision.requests.length, 1, `vision chat`);
                assertEqual(vision.requests[0].messages[0].content, `what`, `text passed`);
                assertEqual(vision.requests[0].messages[0].images?.[0], image, `image passed`);
                assertEqual(visionStatuses[0].supportsImages, true, `vision status`);
                assertEqual(visionStatuses[0].supportsAudio, false, `no audio status`);
                await waitFor(() => replies[replies.length - 1] == `seen`, `vision reply`);
                assertEqual(replies[replies.length - 1], `seen`, `vision reply`);
                assertEqual(visionStatuses[visionStatuses.length - 1].requesting, false, `done`);
                assertEqual(visionStatuses[visionStatuses.length - 1].error, undefined, `no error`);
                const only = chatWith({ chatText: `seen` });
                only.chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [{ role: LlmRole.user, content: ``, images: [image] }],
                    onResponse: () => { },
                });
                await waitFor(() => only.requests.length == 1, `image only chat`);
                assertEqual(only.requests.length, 1, `image only chat`);
                assertEqual(only.requests[0].messages[0].images?.length, 1, `only image passed`);
                assertEqual(only.requests[0].messages[0].content, ``, `no text kept`);
            },
        },
        {
            name: `chat/gpu model`,
            run: async () => {
                const
                    image = `data:image/png;base64,QQ==`,
                    statuses: ChatStatusSnapshot[] = [],
                    replies: string[] = [],
                    { chat, requests } = chatWith({
                        backend: LlmBackend.gpu,
                        chatText: `seen`,
                    });
                chat({
                    model: ChatModelId.gemma4_e2b,
                    messages: [{ role: LlmRole.user, content: `what`, images: [image] }],
                    onResponse: value => replies.push(value),
                    onStatus: value => statuses.push(value),
                });
                await waitFor(() => replies[replies.length - 1] == `seen`, `gpu reply`);
                assertEqual(requests.length, 1, `gpu chat`);
                assertEqual(requests[0].messages[0].images?.[0], image, `gpu image`);
                const last = statuses[statuses.length - 1];
                assertEqual(last.backend, LlmBackend.gpu, `gpu backend`);
                assertEqual(last.supportsImages, true, `gpu supports images`);
                assertEqual(last.supportsAudio, true, `gpu supports audio`);
                assertEqual(last.error, undefined, `gpu no error`);
            },
        },
        {
            name: `chat/audio`,
            run: async () => {
                const audio = `data:audio/wav;base64,QQ==`;
                const
                    gpu = chatWith({ backend: LlmBackend.gpu, chatText: `heard` }),
                    gpuStatuses: ChatStatusSnapshot[] = [],
                    gpuReplies: string[] = [];
                gpu.chat({
                    model: ChatModelId.gemma4_e2b,
                    messages: [{ role: LlmRole.user, content: `listen`, audio: [audio] }],
                    onResponse: value => gpuReplies.push(value),
                    onStatus: value => gpuStatuses.push(value),
                });
                await waitFor(
                    () => gpuReplies[gpuReplies.length - 1] == `heard`,
                    `gpu audio reply`,
                );
                assertEqual(gpu.requests.length, 1, `gpu audio chat`);
                assertEqual(
                    gpu.requests[0].messages[0].audio?.[0],
                    audio,
                    `gpu audio passed`,
                );
                assertEqual(gpu.requests[0].messages[0].content, `listen`, `gpu audio text`);
                assertEqual(gpuStatuses[0].supportsAudio, true, `gpu audio status`);
                assertEqual(
                    gpuStatuses[gpuStatuses.length - 1].error,
                    undefined,
                    `gpu audio no error`,
                );
                const only = chatWith({ backend: LlmBackend.gpu, chatText: `heard` });
                only.chat({
                    model: ChatModelId.gemma4_e2b,
                    messages: [{ role: LlmRole.user, content: ``, audio: [audio] }],
                    onResponse: () => { },
                });
                await waitFor(() => only.requests.length == 1, `audio only chat`);
                assertEqual(only.requests[0].messages[0].audio?.length, 1, `only audio passed`);
                assertEqual(only.requests[0].messages[0].content, ``, `audio no text`);
                const
                    cpu = chatWith(),
                    cpuStatuses: ChatStatusSnapshot[] = [];
                cpu.chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [{ role: LlmRole.user, content: ``, audio: [audio] }],
                    onResponse: () => { },
                    onStatus: value => cpuStatuses.push(value),
                });
                await waitFor(() => cpuStatuses.some(value => !!value.error), `audio rejected`);
                assertEqual(cpu.requests.length, 0, `no cpu audio chat`);
                assertEqual(
                    cpuStatuses[cpuStatuses.length - 1].error,
                    `Model does not accept audio`,
                    `audio error`,
                );
                const
                    stripped = chatWith({ chatText: `ok` }),
                    strippedStatuses: ChatStatusSnapshot[] = [];
                stripped.chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [{
                        role: LlmRole.user,
                        content: `read this`,
                        audio: [audio],
                    }],
                    onResponse: () => { },
                    onStatus: value => strippedStatuses.push(value),
                });
                await waitFor(() => stripped.requests.length == 1, `stripped audio chat`);
                assertEqual(
                    stripped.requests[0].messages[0].audio,
                    undefined,
                    `audio stripped`,
                );
                assertEqual(
                    stripped.requests[0].messages[0].content,
                    `read this`,
                    `stripped text kept`,
                );
                assertEqual(
                    strippedStatuses[strippedStatuses.length - 1].error,
                    undefined,
                    `stripped no error`,
                );
            },
        },
        {
            name: `chat/real image pipeline`,
            run: async () => {
                const
                    source = paintImage(512, 256),
                    sent: EngineMessage[][] = [],
                    replies: string[] = [],
                    statuses: ChatStatusSnapshot[] = [],
                    { chat } = chatWith({
                        chatImpl: async params => await runEngineChat({
                            model: modelOf(ChatModelId.qwen3_vl_2b),
                            params,
                            start: async messages => {
                                sent.push(messages);
                                return streamOf({
                                    choices: [{
                                        delta: { content: `seen` },
                                        finish_reason: `stop`,
                                    }],
                                });
                            },
                            stopped: () => params.signal?.aborted === true,
                        }),
                    });
                chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [{ role: LlmRole.user, content: `what`, images: [source] }],
                    onResponse: value => replies.push(value),
                    onStatus: value => statuses.push(value),
                });
                await waitFor(() => replies[replies.length - 1] == `seen`, `reply`);
                await waitFor(
                    () => statuses[statuses.length - 1]?.requesting === false,
                    `settled`,
                );
                assertEqual(sent.length, 1, `one engine call`);
                const content = sent[0][0].content;
                if (typeof content == `string`) throw new Error(`parts expected`);
                assertEqual(content.length, 2, `text and image`);
                assertEqual(content[0].type, `text`, `text part`);
                if (content[0].type != `text`) throw new Error(`text expected`);
                assertEqual(content[0].text, `what`, `text value`);
                const image = content[1];
                if (image.type != `image`) throw new Error(`image expected`);
                assert(image.url.startsWith(`data:image/jpeg`), `resized jpeg`);
                const bitmap = await createImageBitmap(
                    await (await fetch(image.url)).blob());
                assertEqual(bitmap.width, imageSide, `image width`);
                assertEqual(bitmap.height, imageSide, `image height`);
                bitmap.close();
                assertEqual(replies[replies.length - 1], `seen`, `reply`);
                assertEqual(statuses[statuses.length - 1].error, undefined, `no error`);
            },
        },
        {
            name: `chat/unknown model`,
            run: async () => {
                const
                    { chat, calls } = chatWith(),
                    statuses: ChatStatusSnapshot[] = [];
                chat({
                    model: `missing` as ChatModelId,
                    messages: [userMessage(`hi`)],
                    onResponse: () => { },
                    onStatus: value => statuses.push(value),
                });
                await sleep(10);
                assertEqual(statuses[statuses.length - 1].error, `Unknown model`, `error`);
                assertEqual(calls.start, 0, `no start`);
            },
        },
        {
            name: `chat/empty prompt`,
            run: async () => {
                const
                    { chat, calls } = chatWith(),
                    statuses: ChatStatusSnapshot[] = [];
                chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [{ role: LlmRole.system, content: `only` }],
                    onResponse: () => { },
                    onStatus: value => statuses.push(value),
                });
                await sleep(10);
                assertEqual(calls.start, 0, `no start`);
                assertEqual(statuses.length >= 1, true, `status emitted`);
                assertEqual(statuses[statuses.length - 1].requesting, false, `not requesting`);
            },
        },
        {
            name: `chat/last call wins`,
            run: async () => {
                const
                    gate = deferred(),
                    { chat, requests } = chatWith({
                        chatText: `second`,
                        chatGate: gate.promise,
                    }),
                    firstReplies: string[] = [],
                    secondReplies: string[] = [];
                chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`first`)],
                    onResponse: value => firstReplies.push(value),
                });
                await sleep(10);
                chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`second`)],
                    onResponse: value => secondReplies.push(value),
                });
                await sleep(10);
                assertEqual(requests[0].signal?.aborted, true, `first aborted`);
                gate.resolve();
                await sleep(20);
                assertEqual(firstReplies.length, 0, `first silent`);
                assertEqual(secondReplies[secondReplies.length - 1], `second`, `second reply`);
            },
        },
        {
            name: `chat/cancel stream`,
            run: async () => {
                const
                    gate = deferred(),
                    { chat, calls, requests } = chatWith({ chatGate: gate.promise }),
                    statuses: ChatStatusSnapshot[] = [],
                    replies: string[] = [],
                    cancel = chat({
                        model: ChatModelId.qwen3_vl_2b,
                        messages: [userMessage(`hi`)],
                        onResponse: value => replies.push(value),
                        onStatus: value => statuses.push(value),
                    });
                await sleep(10);
                cancel();
                gate.resolve();
                await sleep(20);
                assertEqual(requests[0].signal?.aborted, true, `stream aborted`);
                assertEqual(calls.unload >= 1, true, `model unloaded`);
                assertEqual(statuses[statuses.length - 1].ready, false, `not ready`);
                assertEqual(statuses[statuses.length - 1].status, LlmStatus.idle, `idle`);
                assertEqual(replies.length, 0, `no reply after cancel`);
            },
        },
        {
            name: `chat/cancel load`,
            run: async () => {
                const
                    gate = deferred(),
                    { chat, calls } = chatWith({ loadGate: gate.promise }),
                    statuses: ChatStatusSnapshot[] = [],
                    cancel = chat({
                        model: ChatModelId.qwen3_vl_2b,
                        messages: [userMessage(`hi`)],
                        onResponse: () => { },
                        onStatus: value => statuses.push(value),
                    });
                await sleep(10);
                cancel();
                gate.resolve();
                await sleep(20);
                assertEqual(calls.chat, 0, `no chat`);
                assertEqual(statuses[statuses.length - 1].status, LlmStatus.idle, `idle`);
                assertEqual(statuses[statuses.length - 1].requesting, false, `not requesting`);
            },
        },
        {
            name: `chat/cancel after reply`,
            run: async () => {
                const
                    { chat, calls } = chatWith(),
                    cancel = chat({
                        model: ChatModelId.qwen3_vl_2b,
                        messages: [userMessage(`hi`)],
                        onResponse: () => { },
                    });
                await sleep(20);
                cancel();
                await sleep(10);
                assertEqual(calls.unload >= 1, true, `model unloaded after reply`);
            },
        },
        {
            name: `chat/stale cancel`,
            run: async () => {
                const
                    { chat, calls } = chatWith(),
                    firstCancel = chat({
                        model: ChatModelId.qwen3_vl_2b,
                        messages: [userMessage(`one`)],
                        onResponse: () => { },
                    });
                await sleep(20);
                chat({
                    model: ChatModelId.qwen3_vl_2b,
                    messages: [userMessage(`two`)],
                    onResponse: () => { },
                });
                firstCancel();
                await sleep(20);
                assertEqual(calls.unload, 0, `stale cancel ignored`);
            },
        },
        {
            name: `chat/minimal input`,
            run: async () => {
                const
                    { chat, calls } = chatWith(),
                    cancel = chat({
                        model: ChatModelId.qwen3_vl_2b,
                        messages: [userMessage(`hi`)],
                        onResponse: () => { },
                    });
                await sleep(20);
                assertEqual(calls.chat, 1, `chat ran with required callbacks`);
                assertEqual(typeof cancel, `function`, `cancel handle`);
            },
        },
        {
            name: `chat/default model`,
            run: async () => {
                const
                    expected = await resolveLlmModel(),
                    cpu = createFakeEngine({ backend: LlmBackend.cpu }),
                    gpu = createFakeEngine({ backend: LlmBackend.gpu }),
                    runtime = createRuntime({
                        engines: { cpu: cpu.engine, litert: gpu.engine },
                    }),
                    replies: string[] = [];
                createChatOn(runtime)({
                    messages: [userMessage(`hi`)],
                    onResponse: value => replies.push(value),
                });
                await waitFor(
                    () => replies[replies.length - 1] == `reply`,
                    `default reply`,
                );
                assertEqual(runtime.model()?.id, expected?.id, `default model`);
                assertEqual(cpu.calls.start + gpu.calls.start, 1, `one load`);
            },
        },
        {
            name: `chat/public entry`,
            run: async () => {
                const statuses: ChatStatusSnapshot[] = [];
                const cancel = createChat({
                    model: `missing` as ChatModelId,
                    messages: [userMessage(`hi`)],
                    onResponse: () => { },
                    onStatus: value => statuses.push(value),
                });
                assertEqual(typeof cancel, `function`, `cancel handle`);
                await sleep(10);
                assertEqual(statuses[statuses.length - 1].error, `Unknown model`, `error`);
                assertEqual(statuses[statuses.length - 1].requesting, false, `not requesting`);
            },
        },
        {
            name: `logging/opt-in`,
            run: async () => {
                const
                    model = modelOf(ChatModelId.qwen3_vl_2b),
                    captured: unknown[][] = [],
                    original = console.log,
                    params = {
                        messages: [userMessage(`hi`)],
                        limits: defaultLlmLimits,
                        reasoning: false,
                        onReason: () => { },
                        onText: () => { },
                    },
                    start = async () => streamOf({
                        choices: [{ delta: { content: `ok` } }],
                    });
                console.log = (...args: unknown[]) => { captured.push(args); };
                try {
                    await runEngineChat({ model, params, start, stopped: () => false });
                    assertEqual(captured.length, 0, `silent by default`);
                    await runEngineChat({
                        model,
                        params: { ...params, logging: true },
                        start,
                        stopped: () => false,
                    });
                    const names = captured.map(args => args[0]);
                    assert(names.includes(`Local chat call`), `call log`);
                    assert(names.includes(`Local chat reply`), `reply log`);
                    assert(names.includes(`Local chat finish`), `finish log`);
                    const logged = captured[0]?.[2] as Array<{ content: string }>;
                    assertEqual(logged[0].content, `****`, `censored messages`);
                    captured.length = 0;
                    await runEngineChat({
                        model,
                        params,
                        start: async () => { throw new Error(`boom`); },
                        stopped: () => false,
                    });
                    assertEqual(captured.length, 0, `failure silent`);
                    await runEngineChat({
                        model,
                        params: { ...params, logging: true },
                        start: async () => { throw new Error(`boom`); },
                        stopped: () => false,
                    });
                    assertEqual(
                        captured.some(args => args[0] == `Local chat failed`),
                        true,
                        `failure log`,
                    );
                    captured.length = 0;
                    const quiet = runtimeWith({ failStart: true });
                    await quiet.runtime.load({
                        model,
                        limits: resolveLlmLimits(),
                        onProgress: () => { },
                    });
                    assertEqual(captured.length, 0, `load failure silent`);
                    const loud = runtimeWith({ failStart: true });
                    await loud.runtime.load({
                        model,
                        limits: resolveLlmLimits(),
                        logging: true,
                        onProgress: () => { },
                    });
                    assertEqual(captured[0]?.[0], `Local model failed`, `load failure log`);
                    captured.length = 0;
                    const { chat, requests, loggings } = chatWith();
                    chat({
                        model: ChatModelId.qwen3_vl_2b,
                        messages: [userMessage(`hi`)],
                        logging: true,
                        onResponse: () => { },
                    });
                    await sleep(20);
                    assertEqual(loggings[0], true, `start logging flag`);
                    assertEqual(requests[0]?.logging, true, `chat logging flag`);
                } finally {
                    console.log = original;
                };
            },
        },
        {
            name: `threads/cap`,
            run: () => {
                assertEqual(cpuThreads(8, 2), 2, `eight cores cap two`);
                assertEqual(cpuThreads(8, 1), 1, `eight cores cap one`);
                assertEqual(cpuThreads(8, 99), 7, `eight cores raw seven`);
                assertEqual(cpuThreads(16, 99), 8, `sixteen cores raw eight`);
                assertEqual(cpuThreads(1, 2), 2, `one core raw two`);
                assertEqual(cpuThreads(8, 3), 3, `eight cores cap three`);
            },
        },
        {
            name: `litert/download once`,
            run: async () => {
                const
                    name = `ds-chat-test-litert`,
                    url = `https://models.test/gemma.litertlm`,
                    bytes = new Uint8Array(4096).fill(7),
                    progress: number[] = [],
                    fetches: string[] = [],
                    original = globalThis.fetch;
                globalThis.fetch = (async (input: RequestInfo | URL) => {
                    fetches.push(`${input}`);
                    return new Response(new Blob([bytes]).stream(), {
                        status: 200,
                        headers: { 'content-length': `${bytes.byteLength}` },
                    });
                }) as typeof fetch;
                try {
                    const cache = await caches.open(name);
                    await Promise.all([
                        cacheModel(url, cache, undefined, value => progress.push(value)),
                        cacheModel(url, cache, undefined, () => { }),
                    ]);
                    assertEqual(fetches.length, 1, `one download`);
                    assertEqual(progress[progress.length - 1], 1, `full progress`);
                    const
                        stored = await cache.match(url),
                        size = (await stored?.arrayBuffer())?.byteLength;
                    assertEqual(size, bytes.byteLength, `stored bytes`);
                    // a settled download is not remembered
                    await cacheModel(url, cache, undefined, () => { });
                    assertEqual(fetches.length, 2, `fresh download after settle`);
                    await caches.delete(name);
                } finally {
                    globalThis.fetch = original;
                };
            },
        },
        {
            name: `store/resume plan`,
            run: () => {
                const
                    part = (size: number, total = 0, etag = ``) =>
                        ({ size, total, etag }),
                    status = (code: number, headers: Record<string, string>) =>
                        new Response(null, { status: code, headers }),
                    ranged = (range: string, etag = ``) => status(206, {
                        'content-range': range,
                        ...(etag ? { etag } : {}),
                    });
                const fresh = resumePlan(
                    status(200, { 'content-length': `100` }),
                    part(0),
                );
                assertEqual(fresh?.start, 0, `fresh start`);
                assertEqual(fresh?.total, 100, `fresh total`);
                assertEqual(fresh?.etag, ``, `fresh etag`);
                const full = resumePlan(
                    status(200, { 'content-length': `100` }),
                    part(40, 100),
                );
                assertEqual(full?.start, 0, `full body restarts`);
                assertEqual(full?.total, 100, `full body total`);
                const next = resumePlan(
                    ranged(`bytes 40-99/100`, `"a"`),
                    part(40, 100, `"a"`),
                );
                assertEqual(next?.start, 40, `resume start`);
                assertEqual(next?.total, 100, `resume total`);
                assertEqual(next?.etag, `"a"`, `resume etag`);
                assertEqual(
                    resumePlan(ranged(`bytes 30-99/100`), part(40, 100)),
                    undefined,
                    `offset restarts`,
                );
                assertEqual(
                    resumePlan(ranged(`bytes 40-99/200`), part(40, 100)),
                    undefined,
                    `size restarts`,
                );
                assertEqual(
                    resumePlan(ranged(`bytes 40-99/100`, `"b"`), part(40, 100, `"a"`)),
                    undefined,
                    `etag restarts`,
                );
                const hidden = resumePlan(status(206, {}), part(40, 100));
                assertEqual(hidden?.start, 40, `hidden range continues`);
                assertEqual(hidden?.total, 100, `hidden range total`);
                const zero = resumePlan(ranged(`bytes 0-99/100`), part(0));
                assertEqual(zero?.start, 0, `zero start`);
                assertEqual(zero?.total, 100, `zero total`);
            },
        },
        {
            name: `store/part chain`,
            run: () => {
                const
                    starts = (parts: Array<{ start: number, size: number }>) =>
                        chainParts(parts).map(part => part.start),
                    size = (parts: Array<{ start: number, size: number }>) =>
                        chainParts(parts).reduce((sum, part) => sum + part.size, 0);
                assertEqual(chainParts([]).length, 0, `empty chain`);
                assertEqual(starts([{ start: 0, size: 10 }]).join(), `0`, `one part`);
                assertEqual(size([{ start: 0, size: 10 }]), 10, `one part size`);
                assertEqual(
                    starts([{ start: 0, size: 10 }, { start: 10, size: 5 }]).join(),
                    `0,10`,
                    `two parts`,
                );
                assertEqual(
                    size([{ start: 0, size: 10 }, { start: 10, size: 5 }]),
                    15,
                    `two part size`,
                );
                assertEqual(
                    starts([{ start: 10, size: 5 }]).length,
                    0,
                    `gap at zero`,
                );
                assertEqual(
                    size([{ start: 0, size: 10 }, { start: 20, size: 5 }]),
                    10,
                    `later gap`,
                );
                assertEqual(
                    size([{ start: 0, size: 10 }, { start: 5, size: 5 }]),
                    10,
                    `overlap stops`,
                );
                assertEqual(
                    size([{ start: 0, size: 0 }, { start: 0, size: 10 }]),
                    10,
                    `empty part skipped`,
                );
                assertEqual(
                    starts([{ start: 10, size: 5 }, { start: 0, size: 10 }]).join(),
                    `0,10`,
                    `unsorted chain`,
                );
            },
        },
        {
            name: `store/resume download`,
            run: async () => {
                const
                    url = `https://models.test/resume.litertlm`,
                    body = new Uint8Array(3000).map((_, index) => index % 251),
                    requests: Array<Record<string, string>> = [],
                    progress: number[] = [],
                    original = globalThis.fetch;
                let dropped = false;
                globalThis.fetch = (async (
                    _input: RequestInfo | URL,
                    init?: RequestInit,
                ) => {
                    const headers = (init?.headers || {}) as Record<string, string>;
                    requests.push(headers);
                    if (!dropped) {
                        dropped = true;
                        // a connection cut short delivers a prefix, then ends
                        const short = new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(body.slice(0, 1000));
                                controller.close();
                            },
                        });
                        return new Response(short, {
                            status: 200,
                            headers: { 'content-length': `3000` },
                        });
                    };
                    const start = Number(
                        /bytes=(\d+)-(\d+)/.exec(headers.Range || ``)?.[1] || 0);
                    if (headers.Range) {
                        const rest = body.slice(start);
                        return new Response(new ReadableStream<Uint8Array>({
                            start(controller) {
                                const half = Math.ceil(rest.length / 2);
                                controller.enqueue(rest.slice(0, half));
                                controller.enqueue(rest.slice(half));
                                controller.close();
                            },
                        }), {
                            status: 206,
                            headers: {
                                'content-range':
                                    `bytes ${start}-${body.length - 1}/${body.length}`,
                            },
                        });
                    };
                    return new Response(body, {
                        status: 200,
                        headers: { 'content-length': `${body.length}` },
                    });
                }) as typeof fetch;
                try {
                    await testStore.purge();
                    const saved = await testStore.download({
                        url,
                        onProgress: value => progress.push(value),
                    });
                    if (!saved) throw new Error(`store unavailable`);
                    assertEqual(saved.complete, true, `resumed complete`);
                    assertEqual(saved.size, 3000, `full size`);
                    assertEqual(requests.length, 2, `one resume`);
                    assertEqual(requests[1].Range, `bytes=1000-2999`, `range request`);
                    assertEqual(Math.round(progress[0] * 3000), 1000, `first part progress`);
                    assertEqual(Math.round(progress[2] * 3000), 2000, `resume progress`);
                    assertEqual(progress[progress.length - 1], 1, `complete progress`);
                    const bytes = new Uint8Array(await saved.file.arrayBuffer());
                    assertEqual(bytes.length, body.length, `stored length`);
                    assertEqual(bytes[1500], body[1500], `stored middle`);
                    assertEqual(bytes[2999], body[2999], `stored tail`);
                    await testStore.remove(url);
                    assertEqual(await testStore.stored(url), undefined, `removed`);
                } finally {
                    globalThis.fetch = original;
                    await testStore.purge();
                };
            },
        },
        {
            name: `store/ignored range resumes`,
            run: async () => {
                const
                    url = `https://models.test/ignored.litertlm`,
                    body = new Uint8Array(3000).map((_, index) => index % 251),
                    full = new Uint8Array(body),
                    requests: Array<Record<string, string>> = [],
                    original = globalThis.fetch;
                // a full body that replays the prefix with wrong bytes
                full.fill(9, 0, 1000);
                let dropped = false;
                globalThis.fetch = (async (
                    _input: RequestInfo | URL,
                    init?: RequestInit,
                ) => {
                    const headers = (init?.headers || {}) as Record<string, string>;
                    requests.push(headers);
                    if (!dropped) {
                        dropped = true;
                        return new Response(new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(body.slice(0, 1000));
                                controller.close();
                            },
                        }), {
                            status: 200,
                            headers: { 'content-length': `3000` },
                        });
                    };
                    // the host ignores the range and sends the whole file
                    return new Response(full, {
                        status: 200,
                        headers: { 'content-length': `3000` },
                    });
                }) as typeof fetch;
                try {
                    await testStore.purge();
                    const saved = await testStore.download({ url, onProgress: () => { } });
                    if (!saved) throw new Error(`store unavailable`);
                    assertEqual(requests.length, 2, `one ignored range`);
                    assertEqual(requests[1].Range, `bytes=1000-2999`, `range ignored`);
                    assertEqual(saved.size, 3000, `ignored full size`);
                    const bytes = new Uint8Array(await saved.file.arrayBuffer());
                    assertEqual(bytes.length, body.length, `ignored length`);
                    assertEqual(bytes[0], body[0], `prefix kept`);
                    assertEqual(bytes[500], body[500], `prefix middle kept`);
                    assertEqual(bytes[1500], body[1500], `suffix written`);
                    assertEqual(bytes[2999], body[2999], `ignored tail`);
                } finally {
                    globalThis.fetch = original;
                    await testStore.purge();
                };
            },
        },
        {
            name: `store/resume after stop`,
            run: async () => {
                const
                    url = `https://models.test/stop.litertlm`,
                    body = new Uint8Array(3000).map((_, index) => index % 251),
                    requests: Array<Record<string, string>> = [],
                    stop = new AbortController(),
                    original = globalThis.fetch;
                let first = true;
                globalThis.fetch = (async (
                    _input: RequestInfo | URL,
                    init?: RequestInit,
                ) => {
                    const headers = (init?.headers || {}) as Record<string, string>;
                    requests.push(headers);
                    if (first) {
                        first = false;
                        // the connection stays open until the caller stops
                        return new Response(new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(body.slice(0, 1000));
                                init?.signal?.addEventListener(`abort`, () =>
                                    controller.error(
                                        new DOMException(`Aborted`, `AbortError`),
                                    ), { once: true });
                            },
                        }), {
                            status: 200,
                            headers: { 'content-length': `3000` },
                        });
                    };
                    const start = Number(
                        /bytes=(\d+)-/.exec(headers.Range || ``)?.[1] || 0);
                    return new Response(body.slice(start), {
                        status: 206,
                        headers: {
                            'content-range':
                                `bytes ${start}-${body.length - 1}/${body.length}`,
                        },
                    });
                }) as typeof fetch;
                try {
                    await testStore.purge();
                    const stopped = await testStore.download({
                        url,
                        signal: stop.signal,
                        onProgress: () => stop.abort(),
                    }).then(
                        () => false,
                        (error: Error) => error.message == `Cancelled`,
                    );
                    assertEqual(stopped, true, `stop ends the download`);
                    const part = await testStore.stored(url);
                    assertEqual(part?.size, 1000, `kept the stored part`);
                    assertEqual(part?.total, 3000, `kept the total`);
                    assertEqual(part?.complete, false, `part open`);
                    const saved = await testStore.download({ url, onProgress: () => { } });
                    if (!saved) throw new Error(`store unavailable`);
                    assertEqual(saved.complete, true, `resumed after stop`);
                    assertEqual(saved.size, 3000, `full size after stop`);
                    assertEqual(requests[1].Range, `bytes=1000-2999`, `range after stop`);
                    const bytes = new Uint8Array(await saved.file.arrayBuffer());
                    assertEqual(bytes.length, body.length, `stopped length`);
                    assertEqual(bytes[0], body[0], `stopped head`);
                    assertEqual(bytes[2999], body[2999], `stopped tail`);
                } finally {
                    globalThis.fetch = original;
                    await testStore.purge();
                };
            },
        },
        {
            name: `store/changed file restarts`,
            run: async () => {
                const
                    url = `https://models.test/changed.litertlm`,
                    first = new Uint8Array(1000).fill(1),
                    second = new Uint8Array(2000).fill(2),
                    requests: Array<Record<string, string>> = [],
                    original = globalThis.fetch;
                let step = 0;
                globalThis.fetch = (async (
                    _input: RequestInfo | URL,
                    init?: RequestInit,
                ) => {
                    const headers = (init?.headers || {}) as Record<string, string>;
                    requests.push(headers);
                    step += 1;
                    if (step == 1) {
                        // the first version ends early, a prefix is kept
                        const short = new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(first);
                                controller.close();
                            },
                        });
                        return new Response(short, {
                            status: 200,
                            headers: {
                                'content-length': `2000`,
                                etag: `"v1"`,
                            },
                        });
                    };
                    const match = /bytes=(\d+)-/.exec(headers.Range || ``);
                    if (match) {
                        const start = Number(match[1]);
                        return new Response(second.slice(start), {
                            status: 206,
                            headers: {
                                'content-range':
                                    `bytes ${start}-${second.length - 1}/${second.length}`,
                                etag: `"v2"`,
                            },
                        });
                    };
                    return new Response(second, {
                        status: 200,
                        headers: {
                            'content-length': `2000`,
                            etag: `"v2"`,
                        },
                    });
                }) as typeof fetch;
                try {
                    await testStore.purge();
                    const saved = await testStore.download({
                        url,
                        onProgress: () => { },
                    });
                    if (!saved) throw new Error(`store unavailable`);
                    assertEqual(requests[0].Range, `bytes=0-33554431`,
                        `first bounded request`);
                    assertEqual(requests[1].Range, `bytes=1000-1999`, `range tried`);
                    assertEqual(requests[2].Range, `bytes=0-33554431`,
                        `restart without stored bytes`);
                    assertEqual(saved.etag, `"v2"`, `new etag`);
                    const bytes = new Uint8Array(await saved.file.arrayBuffer());
                    assertEqual(bytes.length, 2000, `new length`);
                    assertEqual(bytes[0], 2, `new bytes`);
                    assertEqual(bytes[1999], 2, `new tail`);
                } finally {
                    globalThis.fetch = original;
                    await testStore.purge();
                };
            },
        },
        {
            name: `store/multiple parts`,
            run: async () => {
                const
                    url = `https://models.test/parts.litertlm`,
                    size = 40 * 1024 * 1024,
                    firstBytes = 36 * 1024 * 1024,
                    body = new Uint8Array(size),
                    requests: Array<Record<string, string>> = [],
                    original = globalThis.fetch;
                for (let i = 0; i < size; i++) body[i] = i & 255;
                let dropped = false;
                globalThis.fetch = (async (
                    _input: RequestInfo | URL,
                    init?: RequestInit,
                ) => {
                    const headers = (init?.headers || {}) as Record<string, string>;
                    requests.push(headers);
                    if (!dropped) {
                        dropped = true;
                        // a cut after more than one part commits both
                        return new Response(new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(body.slice(0, firstBytes));
                                controller.close();
                            },
                        }), {
                            status: 200,
                            headers: { 'content-length': `${size}` },
                        });
                    };
                    const match = /bytes=(\d+)-(\d+)/.exec(headers.Range || ``);
                    const
                        start = Number(match?.[1] || 0),
                        end = Number(match?.[2] || size - 1);
                    return new Response(body.slice(start, end + 1), {
                        status: 206,
                        headers: {
                            'content-range': `bytes ${start}-${end}/${size}`,
                        },
                    });
                }) as typeof fetch;
                try {
                    await testStore.purge();
                    const saved = await testStore.download({
                        url,
                        onProgress: () => { },
                    });
                    if (!saved) throw new Error(`store unavailable`);
                    assertEqual(saved.size, size, `multiple part size`);
                    assertEqual(
                        requests[1].Range,
                        `bytes=${firstBytes}-${size - 1}`,
                        `part resume range`,
                    );
                    const bytes = new Uint8Array(await saved.file.arrayBuffer());
                    assertEqual(bytes.length, size, `multiple part length`);
                    assertEqual(bytes[32 * 1024 * 1024], body[32 * 1024 * 1024],
                        `part boundary`);
                    assertEqual(bytes[firstBytes], body[firstBytes], `resume boundary`);
                    assertEqual(bytes[size - 1], body[size - 1], `multiple part tail`);
                } finally {
                    globalThis.fetch = original;
                    await testStore.purge();
                };
            },
        },
        {
            name: `store/error names`,
            run: () => {
                assertEqual(
                    isStoreError(new DOMException(``, `NotAllowedError`)),
                    true,
                    `not allowed`,
                );
                assertEqual(
                    isStoreError(new DOMException(``, `NotSupportedError`)),
                    true,
                    `not supported`,
                );
                assertEqual(
                    isStoreError(new DOMException(``, `QuotaExceededError`)),
                    false,
                    `quota is not a store error`,
                );
                assertEqual(isStoreError(new Error(`x`)), false, `plain error`);
            },
        },
        {
            name: `store/cpu files resume`,
            run: async () => {
                const
                    model: ChatModel = {
                        id: ChatModelId.qwen3_vl_2b,
                        reasoning: true,
                        cpu: {
                            repo: `test/cpu`,
                            file: `model.gguf`,
                            mmproj: { file: `mmproj.gguf` },
                        },
                    },
                    textOnly: ChatModel = {
                        id: ChatModelId.qwen3_vl_2b,
                        reasoning: false,
                        cpu: { repo: `test/cpu`, file: `text.gguf` },
                    },
                    files = cpuFiles(model),
                    modelBody = new Uint8Array(3000)
                        .map((_, index) => index % 251),
                    projectorBody = new Uint8Array(2000)
                        .map((_, index) => (index + 7) % 251),
                    requests: Array<{ url: string, range: string }> = [],
                    progress: number[] = [],
                    original = globalThis.fetch;
                assertEqual(files.length, 2, `cpu file count`);
                assertEqual(files[0].url.endsWith(`/model.gguf`), true, `model url`);
                assertEqual(
                    files[1].url.endsWith(`/mmproj.gguf`),
                    true,
                    `projector url`,
                );
                assertEqual(cpuFiles(textOnly).length, 1, `text cpu file`);
                assertEqual(
                    cpuFiles({ ...textOnly, cpu: undefined }).length,
                    0,
                    `no cpu files`,
                );
                const
                    bodies = new Map([
                        [files[0].url, modelBody],
                        [files[1].url, projectorBody],
                    ]),
                    cuts = new Set([files[0].url]);
                globalThis.fetch = (async (
                    input: RequestInfo | URL,
                    init?: RequestInit,
                ) => {
                    const
                        url = `${input}`,
                        headers = (init?.headers || {}) as Record<string, string>,
                        body = bodies.get(url) || new Uint8Array(),
                        range = headers.Range || ``;
                    requests.push({ url, range });
                    if (cuts.delete(url)) {
                        // a cut connection delivers a prefix, then ends
                        return new Response(new ReadableStream<Uint8Array>({
                            start(controller) {
                                controller.enqueue(body.slice(0, 1000));
                                controller.close();
                            },
                        }), {
                            status: 200,
                            headers: { 'content-length': `${body.length}` },
                        });
                    };
                    const match = /bytes=(\d+)-(\d+)/.exec(range);
                    if (match) {
                        const
                            start = Number(match[1]),
                            end = Number(match[2]);
                        return new Response(body.slice(start, end + 1), {
                            status: 206,
                            headers: {
                                'content-range':
                                    `bytes ${start}-${end}/${body.length}`,
                            },
                        });
                    };
                    return new Response(body, {
                        status: 200,
                        headers: { 'content-length': `${body.length}` },
                    });
                }) as typeof fetch;
                try {
                    await cpuStore.purge();
                    const blobs = await storedBlobs({
                        model,
                        onProgress: value => progress.push(value),
                    });
                    if (!blobs) throw new Error(`cpu store unavailable`);
                    assertEqual(blobs.length, 2, `two cpu blobs`);
                    assertEqual(blobs[0].size, modelBody.length, `model size`);
                    assertEqual(
                        blobs[1].size,
                        projectorBody.length,
                        `projector size`,
                    );
                    const
                        modelBytes = new Uint8Array(
                            await blobs[0].arrayBuffer()),
                        projectorBytes = new Uint8Array(
                            await blobs[1].arrayBuffer());
                    assertEqual(modelBytes[1500], modelBody[1500], `model middle`);
                    assertEqual(
                        projectorBytes[1999],
                        projectorBody[1999],
                        `projector tail`,
                    );
                    assertEqual(
                        requests[1].range,
                        `bytes=1000-2999`,
                        `model resumed`,
                    );
                    assertEqual(progress[progress.length - 1], 1, `cpu full progress`);
                    assertEqual(
                        progress.some(value => value > 0 && value < 1),
                        true,
                        `cpu partial progress`,
                    );
                    // a second call reads the store without touching the network
                    const before = requests.length;
                    const again = await storedBlobs({ model, onProgress: () => { } });
                    assertEqual(again?.length, 2, `stored cpu blobs`);
                    assertEqual(requests.length, before, `store skips network`);
                    await cpuStore.remove(files[0].url);
                    assertEqual(
                        await cpuStore.stored(files[0].url),
                        undefined,
                        `cpu removed`,
                    );
                } finally {
                    globalThis.fetch = original;
                    await cpuStore.purge();
                };
            },
        },
        {
            name: `images/square`,
            run: async () => {
                const sizeOf = async (url: string) => {
                    const bitmap = await createImageBitmap(
                        await (await fetch(url)).blob());
                    const size = { width: bitmap.width, height: bitmap.height };
                    bitmap.close();
                    return size;
                };
                const pixelOf = async (url: string, x: number, y: number) => {
                    const
                        bitmap = await createImageBitmap(
                            await (await fetch(url)).blob()),
                        canvas = document.createElement(`canvas`),
                        context = canvas.getContext(`2d`);
                    if (!context) throw new Error(`canvas unavailable`);
                    canvas.width = imageSide;
                    canvas.height = imageSide;
                    context.drawImage(bitmap, 0, 0, imageSide, imageSide);
                    bitmap.close();
                    return Array.from(context.getImageData(x, y, 1, 1).data);
                };
                const [wide, tall, small] = [
                    paintImage(512, 256),
                    paintImage(100, 300),
                    paintImage(64, 64),
                ];
                const resized = await resizeImages([{
                    role: LlmRole.user,
                    content: [
                        { type: `text`, text: `look` },
                        { type: `image`, url: wide },
                        { type: `image`, url: tall },
                        { type: `image`, url: small },
                    ],
                }]);
                const content = resized[0].content;
                if (typeof content == `string`) throw new Error(`parts expected`);
                const images = content.filter(part => part.type == `image`);
                assertEqual(imageSide, 288, `square side`);
                assertEqual(images.length, 3, `image parts`);
                const [wideOut, tallOut, smallOut] = images;
                if (wideOut.type != `image` || tallOut.type != `image`
                    || smallOut.type != `image`) throw new Error(`image parts expected`);
                const [wideSize, tallSize, smallSize, center] = await Promise.all([
                    sizeOf(wideOut.url),
                    sizeOf(tallOut.url),
                    sizeOf(smallOut.url),
                    pixelOf(wideOut.url, 10, imageSide / 2),
                ]);
                assertEqual(wideSize.width, 288, `wide width`);
                assertEqual(wideSize.height, 288, `wide height`);
                assertEqual(tallSize.width, 288, `tall width`);
                assertEqual(tallSize.height, 288, `tall height`);
                assertEqual(smallSize.width, 288, `small width`);
                assertEqual(smallSize.height, 288, `small height`);
                assert(center[1] > center[0], `center crop kept the green middle`);
                const textOnly = await resizeImages([
                    { role: LlmRole.user, content: `plain` },
                ]);
                assertEqual(textOnly[0].content, `plain`, `text kept`);
                const bad = await resizeImageUrl(`not-an-image`);
                assertEqual(bad, `not-an-image`, `bad url kept`);
            },
        },
    ];

/** Run every test and publish the report. */
const main = async (): Promise<void> => {
    for (const definition of definitions)
        await test(definition.name, definition.run);
    const
        pass = outcomes.filter(outcome => outcome.ok).length,
        fail = outcomes.length - pass,
        report = { pass, fail, tests: outcomes },
        json = JSON.stringify(report).replace(`"fail":`, `"fail": `),
        results = document.getElementById(`results`);
    if (results) results.textContent = json;
    console.log(`TESTS_RESULT`, json);
};

void main();
