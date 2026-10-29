// Browser test harness for @degreesign/chat.
import * as entry from "../src/index";
import {
    clearModelCache,
    createChat,
    preloadModel,
} from "../src/index";import { createChatOn, createPreloadOn } from "../src/chat";
import {
    createDescribeOn,
    createTranslateOn,
    describeImages,
    describeTranslated,
} from "../src/describe";
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
    deviceModelId,
    findLlmModel,
    gpuAdapter,
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
    visionLimits,
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
    gpuImageSize,
    imageTokens,
    tokenCell,
    tokenSlack,
    visionSize,
    contentBuffer,
    resizeImageUrl,
    resizeImages,
} from "../src/engines/images";
import {
    ChatModelId,
    ChatStatus,
    BuiltinTool,
    LlmBackend,
    LlmPhase,
    LlmRole,
    LlmStatus,
    WebSearchProvider,
} from "../src/enums";
import {
    builtinTools,
    calculateTool,
    currencyTool,
    webSearchTool,
} from "../src/tools";
import {
    calculate,
    evaluateExpression,
    normalizeExpression,
} from "../src/tools/calculator";
import {
    duckDuckGoResults,
    searchSettings,
    wikipediaResults,
} from "../src/tools/search";
import {
    convert,
    resetPrices,
    sectionsFor,
} from "../src/tools/currency";
import {
    clampNumber,
    decodeEntity,
    plainText,
} from "../src/tools/text";
import type {
    ChatMessage,
    ChatModel,
    ChatStatusSnapshot,
    ChatTool,
    EngineChatParams,
    EngineMessage,
    ImageSize,
    LitertEngine,
    LitertModule,
    LitertSession,
    PriceSnapshot,
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
    },
    /** Run one test with a stubbed fetch, restoring the original. */
    withFetch = async (
        impl: typeof fetch,
        run: () => Promise<void>,
    ): Promise<void> => {
        const original = globalThis.fetch;
        globalThis.fetch = impl;
        try { await run(); } finally { globalThis.fetch = original; };
    },
    /** One JSON response for a stubbed fetch. */
    jsonResponse = (body: unknown, status = 200): Response =>
        new Response(JSON.stringify(body), {
            status,
            headers: { 'content-type': `application/json` },
        }),
    /** The message of one failure, empty when it resolved. */
    errorOf = async (run: () => Promise<unknown>): Promise<string> => {
        try {
            await run();
            return ``;
        } catch (error) {
            return (error as Error).message;
        };
    },
    /** Stub the clock and restore it when the test ends. */
    withClock = (start: number): {
        now: () => number,
        at: (value: number) => void,
        done: () => void,
    } => {
        const
            original = Date.now,
            state = { value: start };
        Date.now = () => state.value;
        return {
            now: () => state.value,
            at: value => { state.value = value; },
            done: () => { Date.now = original; },
        };
    },
    /** The storage key of the currency cache. */
    priceStorageKey = `degreesign-chat-prices-v1`,
    /** Drop the stored price cache. */
    clearPriceStorage = () => {
        try { localStorage.removeItem(priceStorageKey); } catch { };
    },
    /** One tool for the registry tests. */
    toolNamed = (name: string, execute?: ChatTool[`execute`]): ChatTool => ({
        name,
        description: `${name} tool`,
        parameters: { type: `object`, properties: {} },
        execute: execute ?? (() => `ok`),
    }),
    /** Run one test with a stubbed WebGPU adapter, null removes it. */
    withGpu = async (
        run: () => Promise<void>,
        adapter: unknown = {},
    ): Promise<void> => {
        const
            nav = navigator as Navigator & {
                gpu?: { requestAdapter: () => Promise<unknown> },
            },
            hadGpu = Object.prototype.hasOwnProperty.call(nav, `gpu`),
            original = nav.gpu;
        Object.defineProperty(nav, `gpu`, {
            configurable: true,
            value: adapter === null
                ? undefined
                : { requestAdapter: async () => adapter },
        });
        try { await run(); } finally {
            if (hadGpu)
                Object.defineProperty(nav, `gpu`, {
                    configurable: true,
                    value: original,
                });
            else delete nav.gpu;
        };
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
                assertEqual(typeof clearModelCache, `function`, `clearModelCache`);
                assertEqual(typeof describeImages, `function`, `describeImages`);
                assertEqual(
                    typeof describeTranslated,
                    `function`,
                    `describeTranslated`,
                );
                assertEqual(typeof createChatOn, `function`, `createChatOn`);
                assertEqual(typeof createPreloadOn, `function`, `createPreloadOn`);
                assertEqual(typeof createRuntime, `function`, `createRuntime`);
                const names = Object.keys(entry).sort();
                assertEqual(
                    names.join(`,`),
                    [
                        `BuiltinTool`,
                        `ChatModelId`,
                        `ChatStatus`,
                        `LlmBackend`,
                        `LlmPhase`,
                        `LlmRole`,
                        `LlmStatus`,
                        `WebSearchProvider`,
                        `builtinTools`,
                        `calculateTool`,
                        `clearModelCache`,
                        `createChat`,
                        `currencyTool`,
                        `describeImages`,
                        `describeTranslated`,
                        `preloadModel`,
                        `webSearchTool`,
                    ].join(`,`),
                    `public names`,
                );
                assertEqual(`createChatOn` in entry, false, `internal chat factory`);
                assertEqual(
                    `createTranslateOn` in entry,
                    false,
                    `internal translate factory`,
                );
                assertEqual(ChatStatus.online, 0, `online`);
                assertEqual(ChatStatus.away, 1, `away`);
                assertEqual(ChatStatus.offline, 2, `offline`);
                assertEqual(LlmStatus.ready, 2, `ready`);
                assertEqual(LlmBackend.cpu, `cpu`, `cpu backend`);
                assertEqual(LlmBackend.gpu, `gpu`, `gpu backend`);
                assertEqual(LlmPhase.download, `download`, `download phase`);
                assertEqual(LlmRole.assistant, `assistant`, `assistant role`);
                assertEqual(ChatModelId.qwen3_vl_2b, `qwen3-vl-2b`, `qwen id`);
                assertEqual(
                    ChatModelId.qwen3_vl_2b_instruct,
                    `qwen3-vl-2b-instruct`,
                    `qwen instruct id`,
                );
                assertEqual(
                    ChatModelId.qwen3_vl_2b_instruct_q3,
                    `qwen3-vl-2b-instruct-q3`,
                    `qwen instruct q3 id`,
                );
                assertEqual(ChatModelId.gemma4_e2b, `gemma4-e2b`, `gemma id`);
                assertEqual(
                    ChatModelId.gemma4_e2b_limited,
                    `gemma4-e2b-limited`,
                    `limited gemma id`,
                );
                assertEqual(BuiltinTool.websearch, `websearch`, `websearch tool`);
                assertEqual(BuiltinTool.calculate, `calculate`, `calculate tool`);
                assertEqual(BuiltinTool.currency, `currency`, `currency tool`);
                assertEqual(
                    WebSearchProvider.wikipedia,
                    `wikipedia`,
                    `wikipedia provider`,
                );
                assertEqual(
                    WebSearchProvider.duckduckgo,
                    `duckduckgo`,
                    `duckduckgo provider`,
                );
            },
        },
        {
            name: `models/catalog`,
            run: () => {
                assertEqual(llmModels.length, 5, `catalog size`);
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
                const instruct = modelOf(ChatModelId.qwen3_vl_2b_instruct);
                assertEqual(instruct.reasoning, false, `instruct no thinking`);
                assertEqual(
                    instruct.cpu?.repo,
                    `unsloth/Qwen3-VL-2B-Instruct-GGUF`,
                    `instruct repo`,
                );
                assertEqual(
                    instruct.cpu?.file,
                    `Qwen3-VL-2B-Instruct-Q4_K_M.gguf`,
                    `instruct file`,
                );
                assertEqual(
                    instruct.cpu?.mmproj?.repo,
                    `Qwen/Qwen3-VL-2B-Instruct-GGUF`,
                    `instruct projector repo`,
                );
                assertEqual(
                    instruct.cpu?.mmproj?.file,
                    `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf`,
                    `instruct projector`,
                );
                assertEqual(supportsImages(instruct), true, `instruct images`);
                const instructQ3 = modelOf(ChatModelId.qwen3_vl_2b_instruct_q3);
                assertEqual(instructQ3.reasoning, false, `q3 no thinking`);
                assertEqual(
                    instructQ3.cpu?.repo,
                    `unsloth/Qwen3-VL-2B-Instruct-GGUF`,
                    `q3 repo`,
                );
                assertEqual(
                    instructQ3.cpu?.file,
                    `Qwen3-VL-2B-Instruct-Q3_K_M.gguf`,
                    `q3 file`,
                );
                assertEqual(
                    instructQ3.cpu?.mmproj?.repo,
                    `Qwen/Qwen3-VL-2B-Instruct-GGUF`,
                    `q3 projector repo`,
                );
                assertEqual(
                    instructQ3.cpu?.mmproj?.file,
                    `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf`,
                    `q3 projector`,
                );
                assertEqual(supportsImages(instructQ3), true, `q3 images`);
                const gemma = modelOf(ChatModelId.gemma4_e2b);
                assertEqual(gemma.reasoning, true, `gemma reasoning`);
                assertEqual(
                    gemma.litert?.file,
                    `gemma-4-E2B-it.litertlm`,
                    `gemma file`,
                );
                assertEqual(gemma.litert?.vision, true, `gemma vision`);
                assertEqual(gemma.litert?.audio, true, `gemma audio`);
                const limited = modelOf(ChatModelId.gemma4_e2b_limited);
                assertEqual(limited.reasoning, true, `limited reasoning`);
                assertEqual(
                    limited.litert?.repo,
                    gemma.litert?.repo,
                    `limited shared repo`,
                );
                assertEqual(
                    limited.litert?.file,
                    `gemma-4-E2B-it-gpu.litertlm`,
                    `limited file`,
                );
                assertEqual(limited.litert?.vision, false, `limited vision`);
                assertEqual(limited.litert?.audio, false, `limited audio`);
                assertEqual(supportsImages(gemma), true, `gpu images`);
                assertEqual(supportsAudio(gemma), true, `gpu audio`);
                assertEqual(supportsImages(limited), false, `limited images`);
                assertEqual(supportsAudio(limited), false, `limited audio support`);
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
                assertEqual(
                    picked,
                    await gpuAdapter()
                        ? deviceModelId(ChatModelId.gemma4_e2b)
                        : ChatModelId.qwen3_vl_2b,
                    `default device pick`,
                );
                assertEqual((await resolveLlmModel())?.id, picked, `resolved default`);
                assertEqual(
                    (await resolveLlmModel(ChatModelId.qwen3_vl_2b))?.id,
                    ChatModelId.qwen3_vl_2b,
                    `asked model`,
                );
                assertEqual(
                    (await resolveLlmModel(ChatModelId.gemma4_e2b))?.id,
                    deviceModelId(ChatModelId.gemma4_e2b),
                    `asked gemma`,
                );
                assertEqual(
                    (await resolveLlmModel(ChatModelId.gemma4_e2b_limited))?.id,
                    ChatModelId.gemma4_e2b_limited,
                    `asked limited gemma`,
                );
                assertEqual(
                    await resolveLlmModel(`missing` as ChatModelId),
                    undefined,
                    `unknown model`,
                );
            },
        },
        {
            name: `models/gpu timeout`,
            run: async () => {
                const
                    nav = navigator as Navigator & {
                        gpu?: { requestAdapter: () => Promise<unknown> },
                    },
                    hadGpu = Object.prototype.hasOwnProperty.call(nav, `gpu`),
                    original = nav.gpu;
                Object.defineProperty(nav, `gpu`, {
                    configurable: true,
                    value: { requestAdapter: () => new Promise(() => { }) },
                });
                try {
                    const started = Date.now();
                    assertEqual(await gpuAdapter(), false, `hanging adapter`);
                    assert(Date.now() - started < 3000, `bounded probe`);
                } finally {
                    if (hadGpu)
                        Object.defineProperty(nav, `gpu`, {
                            configurable: true,
                            value: original,
                        });
                    else delete nav.gpu;
                };
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
                assertEqual(
                    deviceModelId(ChatModelId.gemma4_e2b),
                    ChatModelId.gemma4_e2b,
                    `desktop gemma`,
                );
                assertEqual(
                    deviceModelId(ChatModelId.gemma4_e2b_limited),
                    ChatModelId.gemma4_e2b_limited,
                    `desktop limited build`,
                );
                assertEqual(
                    deviceModelId(ChatModelId.gemma4_e2b, true),
                    ChatModelId.gemma4_e2b_limited,
                    `mobile gemma swap`,
                );
                assertEqual(
                    deviceModelId(ChatModelId.gemma4_e2b_limited, true),
                    ChatModelId.gemma4_e2b_limited,
                    `mobile limited`,
                );
                assertEqual(
                    deviceModelId(ChatModelId.qwen3_vl_2b, true),
                    ChatModelId.qwen3_vl_2b,
                    `mobile qwen`,
                );
                assertEqual(deviceModelId(undefined, true), undefined, `no model`);
                assertEqual(
                    supportsImages(modelOf(ChatModelId.gemma4_e2b_limited)),
                    false,
                    `limited images`,
                );
                assertEqual(
                    supportsAudio(modelOf(ChatModelId.gemma4_e2b_limited)),
                    false,
                    `limited audio`,
                );
            },
        },
        {
            name: `limits/defaults`,
            run: () => {
                const defaults = resolveLlmLimits();
                assertEqual(defaults.maxReplyTokens, defaultLlmLimits.maxReplyTokens, `reply`);
                assertEqual(defaults.promptCharBudget, 10_000, `budget`);
                assertEqual(defaults.maxImages, 2, `images`);
                assertEqual(defaults.maxAudio, 1, `audio`);
                assertEqual(defaults.maxThreads, 6, `threads`);
                assertEqual(defaults.maxContentLength, 1_000, `content`);
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
            name: `runtime/switch keeps caches`,
            run: async () => {
                const
                    { runtime, calls, models } = runtimeWith({
                        backend: LlmBackend.gpu,
                    }),
                    load = (id: ChatModelId) => runtime.load({
                        model: modelOf(id),
                        limits: resolveLlmLimits(),
                        onProgress: () => { },
                    });
                assertEqual(
                    await load(ChatModelId.gemma4_e2b),
                    true,
                    `desktop loaded`,
                );
                assertEqual(
                    await load(ChatModelId.gemma4_e2b_limited),
                    true,
                    `limited loaded`,
                );
                assertEqual(
                    await load(ChatModelId.gemma4_e2b),
                    true,
                    `desktop reloaded`,
                );
                assertEqual(calls.start, 3, `three builds started`);
                assertEqual(calls.unload, 2, `previous builds released`);
                assertEqual(calls.purge, 0, `no cache deleted`);
                assertEqual(
                    models[2].id,
                    ChatModelId.gemma4_e2b,
                    `desktop build`,
                );
                assertEqual(
                    runtime.model()?.id,
                    ChatModelId.gemma4_e2b,
                    `active build`,
                );
            },
        },
        {
            name: `runtime/clear purges every cache`,
            run: async () => {
                const
                    cpu = createFakeEngine({ backend: LlmBackend.cpu }),
                    gpu = createFakeEngine({ backend: LlmBackend.gpu }),
                    runtime = createRuntime({
                        engines: { cpu: cpu.engine, litert: gpu.engine },
                        backend: LlmBackend.cpu,
                    });
                await runtime.load({
                    model: modelOf(ChatModelId.qwen3_vl_2b),
                    limits: resolveLlmLimits(),
                    onProgress: () => { },
                });
                await runtime.clear();
                assertEqual(cpu.calls.unload, 1, `loaded model released`);
                assertEqual(cpu.calls.purge, 1, `cpu cache purged`);
                assertEqual(gpu.calls.purge, 1, `gpu cache purged`);
                assertEqual(runtime.status(), LlmStatus.idle, `idle status`);
                assertEqual(runtime.model(), undefined, `no active model`);
                assertEqual(runtime.ready(), false, `not ready`);
            },
        },
        {
            name: `runtime/clear stops a load`,
            run: async () => {
                const
                    gate = deferred(),
                    cpu = createFakeEngine({
                        backend: LlmBackend.cpu,
                        loadGate: gate.promise,
                    }),
                    gpu = createFakeEngine({ backend: LlmBackend.gpu }),
                    runtime = createRuntime({
                        engines: { cpu: cpu.engine, litert: gpu.engine },
                        backend: LlmBackend.cpu,
                    }),
                    loading = runtime.load({
                        model: modelOf(ChatModelId.qwen3_vl_2b),
                        limits: resolveLlmLimits(),
                        onProgress: () => { },
                    });
                await waitFor(() => cpu.calls.start == 1, `load started`);
                const clearing = runtime.clear();
                gate.resolve();
                assertEqual(await loading, false, `load stopped`);
                await clearing;
                assertEqual(cpu.calls.purge, 1, `cpu cache purged`);
                assertEqual(gpu.calls.purge, 1, `gpu cache purged`);
                assertEqual(runtime.status(), LlmStatus.idle, `idle status`);
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
                assertEqual(last.model, ChatModelId.gemma4_e2b, `gpu model`);
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
            name: `describe/english`,
            run: async () => {
                const
                    imageSystem = [
                        `Write fully detailed, factual image descriptions for`
                            + ` low-vision readers.`,
                        `Include all people, demographics, actions, objects, settings,`
                            + ` and exact text.`,
                        `Output only the raw description with no intro, title, or`
                            + ` disclaimer.`,
                        `Even if the main subject in the image is controversial`
                            + ` mention it first.`,
                        `Do not say "object appears to be x or y" instead mention`
                            + ` only one "x" or "y" directly.`,
                        `Use direct, plain English without filtering or vague words.`,
                    ].join(` `),
                    imageNote = [
                        `describe this image in one sentence starting with the main subject`,
                    ].join(` `),
                    events: Array<[number, string?, string?, number?]> = [],
                    statuses: ChatStatusSnapshot[] = [];
                let described = 0;
                const
                    cpu = createFakeEngine({
                        backend: LlmBackend.cpu,
                        chatImpl: async () => {
                            await sleep(10);
                            return `A red square ${++described}`;
                        },
                    }),
                    runtime = createRuntime({
                        engines: { cpu: cpu.engine },
                        backend: LlmBackend.cpu,
                    }),
                    results = await createDescribeOn(runtime)({
                        targetLanguage: `en`,
                        images: [`one`, `two`],
                        currentIndex: (index, descriptionEN, description, durationMs) =>
                            events.push([index, descriptionEN, description, durationMs]),
                        onStatus: value => statuses.push(value),
                    });
                assertEqual(cpu.calls.start, 1, `describer load`);
                assertEqual(cpu.calls.chat, 2, `one chat per image`);
                assertEqual(cpu.requests[0].limits.maxReplyTokens, 400, `budget`);
                assertEqual(results.length, 2, `two results`);
                assertEqual(results[0].descriptionEN, `A red square 1`, `first english`);
                assertEqual(results[1].descriptionEN, `A red square 2`, `second english`);
                assertEqual(results[0].description, results[0].descriptionEN, `english kept`);
                assertEqual(results[0].durationMs > 0, true, `first duration`);
                assertEqual(results[1].durationMs > 0, true, `second duration`);
                assertEqual(events.length, 6, `three events per image`);
                assertEqual(events[0][0], 0, `first index`);
                assertEqual(events[0][1], undefined, `first pending`);
                assertEqual(events[0][3], undefined, `pending duration`);
                assertEqual(events[1][1], `A red square 1`, `first english event`);
                assertEqual(events[1][2], undefined, `first awaiting translation`);
                assertEqual(events[1][3], results[0].durationMs, `first event duration`);
                assertEqual(events[2][0], 1, `second index`);
                assertEqual(events[3][1], `A red square 2`, `second english event`);
                assertEqual(
                    events[3][3],
                    results[1].durationMs,
                    `second event duration`,
                );
                assertEqual(events[4][2], `A red square 1`, `first final`);
                assertEqual(events[4][3], results[0].durationMs, `first final duration`);
                assertEqual(events[5][2], `A red square 2`, `second final`);
                assertEqual(
                    events[5][3],
                    results[1].durationMs,
                    `second final duration`,
                );
                assertEqual(cpu.requests[0].messages.length, 2, `two turns`);
                assertEqual(cpu.requests[0].messages[1].role, LlmRole.user, `user role`);
                assertEqual(cpu.requests[0].messages[1].images?.[0], `one`, `first image`);
                assertEqual(cpu.requests[1].messages[1].images?.[0], `two`, `second image`);
                assertEqual(cpu.requests[0].messages[0].role, LlmRole.system, `system role`);
                assertEqual(cpu.requests[0].messages[0].content, imageSystem, `system note`);
                assertEqual(
                    cpu.requests[0].messages[1].content,
                    imageNote,
                    `image note`,
                );
                assertEqual(
                    statuses[0].model,
                    ChatModelId.qwen3_vl_2b_instruct_q3,
                    `describer status`,
                );
                assertEqual(statuses[0].requesting, false, `idle status`);
                assertEqual(statuses[0].supportsImages, true, `vision status`);
                assertEqual(
                    statuses.some(value => value.requesting),
                    true,
                    `requesting status`,
                );
                assertEqual(
                    statuses[statuses.length - 1].requesting,
                    false,
                    `final status`,
                );
                assertEqual(statuses[statuses.length - 1].ready, true, `final ready`);
                assertEqual(statuses[statuses.length - 1].percent, 100, `final percent`);
                assertEqual(
                    statuses[statuses.length - 1].error,
                    undefined,
                    `final error`,
                );
            },
        },
        {
            name: `describe/translation`,
            run: async () => {
                await withGpu(async () => {
                    const
                        events: Array<[number, string?, string?, number?]> = [],
                        statuses: ChatStatusSnapshot[] = [],
                        prompts: string[] = [];
                    let described = 0;
                    const
                        cpu = createFakeEngine({
                            backend: LlmBackend.cpu,
                            chatImpl: async () => `description ${++described}`,
                        }),
                        gpu = createFakeEngine({
                            backend: LlmBackend.gpu,
                            chatImpl: async params => {
                                prompts.push(
                                    params.messages
                                        .map(message => `${message.content}`)
                                        .join(`\n`),
                                );
                                return `translated ${prompts.length}`;
                            },
                        }),
                        runtime = createRuntime({
                            engines: { cpu: cpu.engine, litert: gpu.engine },
                        }),
                        results = await createDescribeOn(runtime)({
                            targetLanguage: `German`,
                            images: [`one`, `two`],
                            currentIndex: (index, descriptionEN, description, durationMs) =>
                                events.push([index, descriptionEN, description, durationMs]),
                            onStatus: value => statuses.push(value),
                        });
                    assertEqual(
                        cpu.models[0].id,
                        ChatModelId.qwen3_vl_2b_instruct_q3,
                        `describer model`,
                    );
                    assertEqual(
                        gpu.models[0].id,
                        ChatModelId.gemma4_e2b_limited,
                        `translator model`,
                    );
                    const translateSystem = [
                        `You are a precise translator.`,
                        `Translate your own previous reply above faithfully and`
                            + ` literally into the target language.`,
                        `Never translate the user's request or instructions.`,
                        `Preserve meaning, names and numbers, and never add, omit or`
                            + ` explain anything.`,
                    ].join(` `);
                    const translatePrompt = `Now please translate your previous reply`
                        + ` above faithfully into German. Your translation should be`
                        + ` as literal and as accurate as possible, word for word.`
                        + ` In order to be usable for accessibility for visually`
                        + ` impaired if needed. Reply only by the translation`
                        + ` without any addition or explanation`;
                    assertEqual(cpu.calls.start, 1, `describer start`);
                    assertEqual(gpu.calls.start, 1, `translator start`);
                    assertEqual(cpu.requests[0].limits.maxReplyTokens, 400, `describer budget`);
                    assertEqual(gpu.requests[0].limits.maxReplyTokens, 400, `budget`);
                    assertEqual(cpu.requests[0].messages.length, 2, `describer turns`);
                    assertEqual(gpu.requests[0].messages.length, 4, `translation turns`);
                    assertEqual(gpu.requests[0].messages[0].role, LlmRole.system, `system turn`);
                    assertEqual(
                        gpu.requests[0].messages[0].content,
                        translateSystem,
                        `system note`,
                    );
                    assertEqual(
                        gpu.requests[0].messages[1].content,
                        `[image] describe this image in English very accurately`,
                        `translation image note`,
                    );
                    assertEqual(
                        gpu.requests[0].messages[2].role,
                        LlmRole.assistant,
                        `english turn`,
                    );
                    assertEqual(
                        gpu.requests[0].messages[2].content,
                        `description 1`,
                        `english content`,
                    );
                    assertEqual(
                        gpu.requests[0].messages[3].role,
                        LlmRole.user,
                        `prompt turn`,
                    );
                    assertEqual(
                        gpu.requests[0].messages[3].content,
                        translatePrompt,
                        `prompt note`,
                    );
                    assertEqual(results[0].descriptionEN, `description 1`, `first english`);
                    assertEqual(results[0].description, `translated 1`, `first translation`);
                    assertEqual(results[1].description, `translated 2`, `second translation`);
                    assert(
                        typeof results[0].durationMs == `number`,
                        `first duration`,
                    );
                    assert(
                        typeof results[1].durationMs == `number`,
                        `second duration`,
                    );
                    assert(prompts[0].includes(`German`), `target language`);
                    assert(prompts[0].includes(`description 1`), `source text`);
                    assertEqual(events.length, 6, `three events per image`);
                    assertEqual(events[1][3], results[0].durationMs, `english duration`);
                    assertEqual(events[4][2], `translated 1`, `first final`);
                    assertEqual(events[4][3], results[0].durationMs, `first final duration`);
                    assertEqual(events[5][2], `translated 2`, `second final`);
                    assertEqual(events[5][3], results[1].durationMs, `second final duration`);
                    assertEqual(
                        statuses.some(value =>
                            value.model == ChatModelId.gemma4_e2b_limited),
                        true,
                        `translator status`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].model,
                        ChatModelId.gemma4_e2b_limited,
                        `translator final`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].supportsImages,
                        false,
                        `translator vision`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].ready,
                        true,
                        `translator ready`,
                    );
                });
            },
        },
        {
            name: `describe/translated`,
            run: async () => {
                await withGpu(async () => {
                    const
                        events: Array<[number, string?, string?]> = [],
                        statuses: ChatStatusSnapshot[] = [],
                        gpu = createFakeEngine({
                            backend: LlmBackend.gpu,
                            chatImpl: async params =>
                                `translated ${params.messages[2]?.content}`,
                        }),
                        runtime = createRuntime({
                            engines: { litert: gpu.engine },
                        }),
                        results = await createTranslateOn(runtime)({
                            descriptions: [`plain one`, `plain two`],
                            targetLanguage: `German`,
                            currentIndex: (index, descriptionEN, description) =>
                                events.push([index, descriptionEN, description]),
                            onStatus: value => statuses.push(value),
                        });
                    assertEqual(gpu.calls.start, 1, `translator start`);
                    assertEqual(gpu.calls.chat, 2, `one chat per description`);
                    assertEqual(gpu.requests[0].limits.maxReplyTokens, 400, `budget`);
                    assertEqual(gpu.requests[0].messages.length, 4, `four turns`);
                    assertEqual(results[0], `translated plain one`, `first translation`);
                    assertEqual(results[1], `translated plain two`, `second translation`);
                    assertEqual(events.length, 2, `two events`);
                    assertEqual(events[0][0], 0, `first index`);
                    assertEqual(events[0][1], `plain one`, `first english`);
                    assertEqual(events[0][2], `translated plain one`, `first event`);
                    assertEqual(events[1][0], 1, `second index`);
                    assertEqual(events[1][1], `plain two`, `second english`);
                    assertEqual(events[1][2], `translated plain two`, `second event`);
                    assertEqual(
                        statuses[statuses.length - 1].model,
                        ChatModelId.gemma4_e2b_limited,
                        `translator final`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].requesting,
                        false,
                        `translator done`,
                    );
                });
            },
        },
        {
            name: `describe/translated english`,
            run: async () => {
                const
                    gpu = createFakeEngine({ backend: LlmBackend.gpu }),
                    runtime = createRuntime({
                        engines: { litert: gpu.engine },
                    }),
                    results = await createTranslateOn(runtime)({
                        descriptions: [`plain one`],
                        targetLanguage: `en`,
                    });
                assertEqual(results[0], `plain one`, `english kept`);
                assertEqual(gpu.calls.start, 0, `no load`);
            },
        },
        {
            name: `describe/translated refusal`,
            run: async () => {
                await withGpu(async () => {
                    const
                        gpu = createFakeEngine({
                            backend: LlmBackend.gpu,
                            chatImpl: async () => `"CANNOT TRANSLATE."`,
                        }),
                        runtime = createRuntime({
                            engines: { litert: gpu.engine },
                        }),
                        results = await createTranslateOn(runtime)({
                            descriptions: [`plain one`],
                            targetLanguage: `fa`,
                        });
                    assertEqual(results[0], `plain one`, `english kept on refusal`);
                });
            },
        },
        {
            name: `describe/refusal`,
            run: async () => {
                await withGpu(async () => {
                    const
                        events: Array<[number, string?, string?, number?]> = [],
                        cpu = createFakeEngine({
                            backend: LlmBackend.cpu,
                            chatImpl: async () => `plain english`,
                        }),
                        gpu = createFakeEngine({
                            backend: LlmBackend.gpu,
                            chatImpl: async () => `"CANNOT TRANSLATE."`,
                        }),
                        runtime = createRuntime({
                            engines: { cpu: cpu.engine, litert: gpu.engine },
                        }),
                        results = await createDescribeOn(runtime)({
                            targetLanguage: `fa`,
                            images: [`one`],
                            limits: { maxReplyTokens: 64 },
                            currentIndex: (index, descriptionEN, description, durationMs) =>
                                events.push([index, descriptionEN, description, durationMs]),
                        });
                    assertEqual(cpu.requests[0].limits.maxReplyTokens, 64, `describer budget`);
                    assertEqual(gpu.requests[0].limits.maxReplyTokens, 64, `translator budget`);
                    assertEqual(results[0].description, `plain english`, `english kept`);
                    assertEqual(events[2][2], `plain english`, `refusal event`);
                    assertEqual(events[2][3], results[0].durationMs, `refusal duration`);
                });
            },
        },
        {
            name: `describe/no gpu`,
            run: async () => {
                await withGpu(async () => {
                    const
                        events: Array<[number, string?, string?, number?]> = [],
                        statuses: ChatStatusSnapshot[] = [],
                        cpu = createFakeEngine({
                            backend: LlmBackend.cpu,
                            chatImpl: async () => `plain english`,
                        }),
                        runtime = createRuntime({
                            engines: { cpu: cpu.engine },
                            backend: LlmBackend.cpu,
                        }),
                        results = await createDescribeOn(runtime)({
                            targetLanguage: `fr`,
                            images: [`one`],
                            currentIndex: (index, descriptionEN, description, durationMs) =>
                                events.push([index, descriptionEN, description, durationMs]),
                            onStatus: value => statuses.push(value),
                        });
                    assertEqual(cpu.calls.start, 1, `describer load`);
                    assertEqual(results[0].description, `plain english`, `english fallback`);
                    assertEqual(events.length, 3, `three events`);
                    assertEqual(events[2][2], `plain english`, `fallback event`);
                    assertEqual(events[2][3], results[0].durationMs, `fallback duration`);
                    assertEqual(
                        statuses.some(value =>
                            value.model == ChatModelId.gemma4_e2b_limited),
                        false,
                        `no translator status`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].model,
                        ChatModelId.qwen3_vl_2b_instruct_q3,
                        `describer final`,
                    );
                }, null);
            },
        },
        {
            name: `describe/translation failure`,
            run: async () => {
                await withGpu(async () => {
                    const
                        events: Array<[number, string?, string?, number?]> = [],
                        statuses: ChatStatusSnapshot[] = [],
                        cpu = createFakeEngine({
                            backend: LlmBackend.cpu,
                            chatImpl: async () => `plain english`,
                        }),
                        gpu = createFakeEngine({
                            backend: LlmBackend.gpu,
                            failStart: true,
                        }),
                        runtime = createRuntime({
                            engines: { cpu: cpu.engine, litert: gpu.engine },
                        }),
                        results = await createDescribeOn(runtime)({
                            targetLanguage: `de`,
                            images: [`one`],
                            currentIndex: (index, descriptionEN, description, durationMs) =>
                                events.push([index, descriptionEN, description, durationMs]),
                            onStatus: value => statuses.push(value),
                        });
                    assertEqual(gpu.calls.start, 1, `translator attempted`);
                    assertEqual(results[0].description, `plain english`, `english kept`);
                    assertEqual(events[2][2], `plain english`, `fallback event`);
                    assertEqual(events[2][3], results[0].durationMs, `failure duration`);
                    assertEqual(
                        statuses[statuses.length - 1].model,
                        ChatModelId.gemma4_e2b_limited,
                        `translator final`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].error,
                        `start failed`,
                        `translator error`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].status,
                        LlmStatus.error,
                        `translator failed`,
                    );
                });
            },
        },
        {
            name: `describe/empty and failures`,
            run: async () => {
                const
                    emptyStatuses: ChatStatusSnapshot[] = [],
                    loadStatuses: ChatStatusSnapshot[] = [],
                    replyStatuses: ChatStatusSnapshot[] = [],
                    idle = createFakeEngine({ backend: LlmBackend.cpu }),
                    idleRuntime = createRuntime({
                        engines: { cpu: idle.engine },
                        backend: LlmBackend.cpu,
                    }),
                    empty = await createDescribeOn(idleRuntime)({
                        targetLanguage: `de`,
                        images: [],
                        onStatus: value => emptyStatuses.push(value),
                    }),
                    failed = createFakeEngine({
                        backend: LlmBackend.cpu,
                        failStart: true,
                    }),
                    failedRuntime = createRuntime({
                        engines: { cpu: failed.engine },
                        backend: LlmBackend.cpu,
                    }),
                    loadError = await errorOf(() => createDescribeOn(failedRuntime)({
                        targetLanguage: `en`,
                        images: [`one`],
                        onStatus: value => loadStatuses.push(value),
                    })),
                    silent = createFakeEngine({
                        backend: LlmBackend.cpu,
                        chatImpl: async () => ``,
                    }),
                    silentRuntime = createRuntime({
                        engines: { cpu: silent.engine },
                        backend: LlmBackend.cpu,
                    }),
                    silentResults = await createDescribeOn(silentRuntime)({
                        targetLanguage: `en`,
                        images: [`one`],
                        onStatus: value => replyStatuses.push(value),
                    });
                assertEqual(empty.length, 0, `no results`);
                assertEqual(idle.calls.start, 0, `empty skips load`);
                assertEqual(emptyStatuses.length, 0, `empty skips status`);
                assertEqual(loadError, `start failed`, `load error`);
                assertEqual(
                    loadStatuses[loadStatuses.length - 1].error,
                    `start failed`,
                    `load status`,
                );
                assertEqual(
                    loadStatuses[loadStatuses.length - 1].requesting,
                    false,
                    `load done`,
                );
                // an empty reply keeps its place and only reports the error
                assertEqual(silentResults.length, 1, `empty kept`);
                assertEqual(silentResults[0].descriptionEN, ``, `empty english`);
                assertEqual(
                    replyStatuses[replyStatuses.length - 1].error,
                    `No description`,
                    `reply status`,
                );
            },
        },
        {
            name: `describe/failed image isolation`,
            run: async () => {
                const
                    statuses: ChatStatusSnapshot[] = [],
                    events: Array<[number, string?, string?]> = [];
                let described = 0;
                const
                    cpu = createFakeEngine({
                        backend: LlmBackend.cpu,
                        chatImpl: async () => {
                            if (++described > 1) throw new Error(`image failed`);
                            return `A red square`;
                        },
                    }),
                    runtime = createRuntime({
                        engines: { cpu: cpu.engine },
                        backend: LlmBackend.cpu,
                    }),
                    results = await createDescribeOn(runtime)({
                        targetLanguage: `en`,
                        images: [`one`, `two`],
                        currentIndex: (index, descriptionEN, description) =>
                            events.push([index, descriptionEN, description]),
                        onStatus: value => statuses.push(value),
                    });
                // the second image fails, the first one is kept
                assertEqual(results.length, 2, `two results`);
                assertEqual(results[0].descriptionEN, `A red square`, `first kept`);
                assertEqual(results[1].descriptionEN, ``, `second empty`);
                assertEqual(cpu.calls.chat, 2, `both images tried`);
                assertEqual(
                    events.some(([index, en]) => index == 0 && en == `A red square`),
                    true,
                    `first event`,
                );
                assertEqual(
                    statuses.some(value => value.error == `image failed`),
                    true,
                    `failure reported`,
                );
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
                assertEqual(
                    statuses[0].model,
                    ChatModelId.qwen3_vl_2b,
                    `model start`,
                );
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
                assertEqual(statuses[0].model, ChatModelId.gemma4_e2b, `gpu model start`);
                assertEqual(last.backend, LlmBackend.gpu, `gpu backend`);
                assertEqual(last.supportsImages, true, `gpu supports images`);
                assertEqual(last.supportsAudio, true, `gpu supports audio`);
                assertEqual(last.error, undefined, `gpu no error`);
            },
        },
        {
            name: `chat/mobile gemma build`,
            run: async () => {
                const
                    nav = navigator as Navigator & {
                        userAgentData?: { mobile?: boolean },
                    },
                    hadAgent = Object.prototype.hasOwnProperty.call(nav, `userAgent`),
                    agent = nav.userAgent,
                    hadHints = Object.prototype.hasOwnProperty.call(nav, `userAgentData`),
                    hints = nav.userAgentData;
                Object.defineProperty(nav, `userAgent`, {
                    configurable: true,
                    value: `Mozilla/5.0 (Linux; Android 14; Pixel 8)`,
                });
                Object.defineProperty(nav, `userAgentData`, {
                    configurable: true,
                    value: { mobile: true },
                });
                try {
                    const
                        statuses: ChatStatusSnapshot[] = [],
                        { chat, models, requests } = chatWith({
                            backend: LlmBackend.gpu,
                            chatText: `seen`,
                        });
                    chat({
                        model: ChatModelId.gemma4_e2b,
                        messages: [userMessage(`hi`)],
                        onResponse: () => { },
                        onStatus: value => statuses.push(value),
                    });
                    await waitFor(() => requests.length == 1, `mobile swap chat`);
                    assertEqual(
                        models[0].id,
                        ChatModelId.gemma4_e2b_limited,
                        `mobile build loaded`,
                    );
                    assertEqual(
                        statuses[0].model,
                        ChatModelId.gemma4_e2b_limited,
                        `mobile build start`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].model,
                        ChatModelId.gemma4_e2b_limited,
                        `mobile build end`,
                    );
                    assertEqual(statuses[0].supportsImages, false, `mobile no images`);
                    assertEqual(statuses[0].supportsAudio, false, `mobile no audio`);
                } finally {
                    if (hadAgent)
                        Object.defineProperty(nav, `userAgent`, {
                            configurable: true,
                            value: agent,
                        });
                    else delete (nav as unknown as Record<string, unknown>).userAgent;
                    if (hadHints)
                        Object.defineProperty(nav, `userAgentData`, {
                            configurable: true,
                            value: hints,
                        });
                    else delete (nav as unknown as Record<string, unknown>).userAgentData;
                };
            },
        },
        {
            name: `chat/desktop limited build`,
            run: async () => {
                const
                    nav = navigator as Navigator & {
                        userAgentData?: { mobile?: boolean },
                    },
                    hadAgent = Object.prototype.hasOwnProperty.call(nav, `userAgent`),
                    agent = nav.userAgent,
                    hadHints = Object.prototype.hasOwnProperty.call(nav, `userAgentData`),
                    hints = nav.userAgentData;
                Object.defineProperty(nav, `userAgent`, {
                    configurable: true,
                    value: `Mozilla/5.0 (X11; Linux x86_64)`,
                });
                Object.defineProperty(nav, `userAgentData`, {
                    configurable: true,
                    value: { mobile: false },
                });
                try {
                    const
                        statuses: ChatStatusSnapshot[] = [],
                        { chat, models, requests } = chatWith({
                            backend: LlmBackend.gpu,
                            chatText: `seen`,
                        });
                    chat({
                        model: ChatModelId.gemma4_e2b_limited,
                        messages: [userMessage(`hi`)],
                        onResponse: () => { },
                        onStatus: value => statuses.push(value),
                    });
                    await waitFor(() => requests.length == 1, `limited chat`);
                    assertEqual(
                        models[0].id,
                        ChatModelId.gemma4_e2b_limited,
                        `desktop limited loaded`,
                    );
                    assertEqual(
                        statuses[0].model,
                        ChatModelId.gemma4_e2b_limited,
                        `limited build start`,
                    );
                    assertEqual(
                        statuses[statuses.length - 1].model,
                        ChatModelId.gemma4_e2b_limited,
                        `limited build end`,
                    );
                    assertEqual(statuses[0].supportsImages, false, `limited no images`);
                    assertEqual(statuses[0].supportsAudio, false, `limited no audio`);
                } finally {
                    if (hadAgent)
                        Object.defineProperty(nav, `userAgent`, {
                            configurable: true,
                            value: agent,
                        });
                    else delete (nav as unknown as Record<string, unknown>).userAgent;
                    if (hadHints)
                        Object.defineProperty(nav, `userAgentData`, {
                            configurable: true,
                            value: hints,
                        });
                    else delete (nav as unknown as Record<string, unknown>).userAgentData;
                };
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
                assertEqual(bitmap.width, 512, `image width`);
                assertEqual(bitmap.height, 256, `image height`);
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
                assertEqual(statuses[statuses.length - 1].error, `No prompt`, `no prompt error`);
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
                assertEqual(cpuThreads(8, 99), 3, `eight cores hard cap three`);
                assertEqual(cpuThreads(16, 99), 3, `sixteen cores hard cap three`);
                assertEqual(cpuThreads(1, 2), 2, `one core raw two`);
                assertEqual(cpuThreads(8, 3), 3, `eight cores cap three`);
                assertEqual(cpuThreads(8, 6), 3, `default budget three`);
                assertEqual(cpuThreads(8, 99, true), 2, `vision cap two`);
                assertEqual(cpuThreads(8, 1, true), 1, `vision one`);
            },
        },
        {
            name: `wllama/vision limits`,
            run: () => {
                const
                    instruct = visionLimits(
                        modelOf(ChatModelId.qwen3_vl_2b_instruct)),
                    instructQ3 = visionLimits(
                        modelOf(ChatModelId.qwen3_vl_2b_instruct_q3)),
                    thinking = visionLimits(modelOf(ChatModelId.qwen3_vl_2b)),
                    text = visionLimits(modelOf(ChatModelId.gemma4_e2b));
                assertEqual(instruct.image_min_tokens, 16, `instruct min`);
                assertEqual(instruct.image_max_tokens, 100, `instruct max`);
                assertEqual(instructQ3.image_min_tokens, 16, `q3 min`);
                assertEqual(instructQ3.image_max_tokens, 100, `q3 max`);
                assertEqual(Object.keys(thinking).length, 0, `thinking unset`);
                assertEqual(Object.keys(text).length, 0, `text unset`);
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
                            mmproj: {
                                repo: `test/projector`,
                                file: `mmproj.gguf`,
                            },
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
                assertEqual(
                    files[1].url.includes(`/test/projector/`),
                    true,
                    `projector repo override`,
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
                    canvas.width = bitmap.width;
                    canvas.height = bitmap.height;
                    context.drawImage(bitmap, 0, 0);
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
                assertEqual(images.length, 3, `image parts`);
                const [wideOut, tallOut, smallOut] = images;
                if (wideOut.type != `image` || tallOut.type != `image`
                    || smallOut.type != `image`) throw new Error(`image parts expected`);
                const [wideSize, tallSize, smallSize] = await Promise.all([
                    sizeOf(wideOut.url),
                    sizeOf(tallOut.url),
                    sizeOf(smallOut.url),
                ]);
                assertEqual(wideSize.width, 512, `wide width`);
                assertEqual(wideSize.height, 256, `wide height`);
                assertEqual(tallSize.width, 224, `tall width`);
                assertEqual(tallSize.height, 608, `tall height`);
                assertEqual(smallSize.width, 352, `small width`);
                assertEqual(smallSize.height, 384, `small height`);
                const tokensOf = (size: ImageSize): number =>
                    size.width / tokenCell * size.height / tokenCell;
                assert(tokensOf(wideSize) >= imageTokens, `wide target`);
                assert(tokensOf(wideSize) <= imageTokens + tokenSlack, `wide slack`);
                assert(tokensOf(tallSize) >= imageTokens, `tall target`);
                assert(tokensOf(tallSize) <= imageTokens + tokenSlack, `tall slack`);
                const center = await pixelOf(
                    wideOut.url,
                    wideSize.width / 2,
                    wideSize.height / 2,
                );
                assert(center[1] > center[0], `full frame kept the green middle`);
                const
                    big = visionSize(4032, 3024),
                    bigTokens = big.width / tokenCell * big.height / tokenCell;
                assertEqual(big.width % tokenCell, 0, `grid width`);
                assertEqual(big.height % tokenCell, 0, `grid height`);
                assert(bigTokens >= imageTokens, `big target`);
                assert(bigTokens <= imageTokens + tokenSlack, `big slack`);
                assertEqual(gpuImageSize.width, 384, `gpu width`);
                assertEqual(gpuImageSize.height, 384, `gpu height`);
                const textOnly = await resizeImages([
                    { role: LlmRole.user, content: `plain` },
                ]);
                assertEqual(textOnly[0].content, `plain`, `text kept`);
                const bad = await resizeImageUrl(`not-an-image`);
                assertEqual(bad, `not-an-image`, `bad url kept`);
            },
        },
        {
            name: `tools/calculator`,
            run: () => {
                const
                    fails = (input: string): string => {
                        try {
                            calculate(input);
                            return ``;
                        } catch (error) {
                            return (error as Error).message;
                        };
                    },
                    cases: Array<[string, number]> = [
                        [`2+3*4`, 14],
                        [`(2+3)*4`, 20],
                        [`-2^2`, -4],
                        [`2^3^2`, 512],
                        [`2^-2`, 0.25],
                        [`200*15%`, 30],
                        [`200+10%`, 200.1],
                        [`1,234+1`, 1235],
                        [`3×4÷2−1`, 5],
                        [`+7`, 7],
                        [`0.5^0.5`, 0.707106781187],
                        [`1/3`, 0.333333333333],
                        [`0.1+0.2`, 0.3],
                        [`123456789*2`, 246913578],
                        [`0.0000001*0.0000001`, 1e-14],
                        [`100000*2`, 200000],
                    ];
                for (const [expression, expected] of cases)
                    assertEqual(calculate(expression).result, expected, expression);
                assertEqual(calculate(` 2 × 3 `).expression, `2*3`, `normalized`);
                assertEqual(normalizeExpression(`1,000 ÷ 4`), `1000/4`, `normalize`);
                assertEqual(evaluateExpression(`2*(3+4)`), 14, `evaluate`);
                assertEqual(fails(``), `Expression is empty`, `empty`);
                assertEqual(fails(`   `), `Expression is empty`, `blank`);
                assertEqual(fails(`2+`), `Expected a number`, `missing operand`);
                assertEqual(fails(`(2+3`), `Unbalanced parentheses`, `unbalanced`);
                assertEqual(fails(`2(3+4)`), `Unexpected character`, `implicit product`);
                assertEqual(fails(`1/0`), `Division by zero`, `divide by zero`);
                assertEqual(fails(`9^9^9`), `Result is not a finite number`, `overflow`);
                assertEqual(fails(`2 & 3`), `Unsupported character`, `character`);
                assertEqual(fails(`1`.repeat(201)), `Expression is too long`, `length`);
                assertEqual(calculateTool.name, `calculate`, `tool name`);
                assertEqual(
                    calculateTool.parameters?.required?.[0],
                    `expression`,
                    `required`,
                );
                const output = calculateTool.execute({ expression: `6*7` });
                assertEqual((output as { result: number }).result, 42, `tool answer`);
                let missing = ``;
                try { calculateTool.execute({}); }
                catch (error) { missing = (error as Error).message; };
                assertEqual(missing, `Missing expression`, `missing argument`);
            },
        },
        {
            name: `tools/text`,
            run: () => {
                assertEqual(
                    plainText(`<b>a</b>&nbsp;&amp;&#65;&#x42;&unknown;`, 40),
                    `a &AB&unknown;`,
                    `markup and entities`,
                );
                assertEqual(plainText(`one   two\nthree`, 100), `one two three`, `spaces`);
                assertEqual(plainText(`abcdef`, 4), `abcd`, `clamp`);
                assertEqual(plainText(`  abcdef  `, 3), `abc`, `clamp after trim`);
                assertEqual(decodeEntity(`#39`), `'`, `numeric entity`);
                assertEqual(decodeEntity(`#x41`), `A`, `hex entity`);
                assertEqual(decodeEntity(`#0`), `#0`, `zero code`);
                assertEqual(decodeEntity(`#x110000`), `#x110000`, `out of range`);
                assertEqual(decodeEntity(`unknown`), `unknown`, `unknown entity`);
                assertEqual(clampNumber(undefined, 1, 20, 3), 3, `fallback`);
                assertEqual(clampNumber(50, 1, 20, 3), 20, `max`);
                assertEqual(clampNumber(-5, 1, 20, 3), 1, `min`);
                assertEqual(clampNumber(NaN, 1, 20, 3), 3, `nan`);
                assertEqual(clampNumber(Infinity, 1, 20, 3), 3, `infinity`);
            },
        },
        {
            name: `tools/search wikipedia`,
            run: async () => {
                const
                    body = {
                        pages: [
                            {
                                key: `Earth`,
                                title: `Earth`,
                                description: `Third planet`,
                                excerpt: `Earth is <span class="searchmatch">the</span>`
                                    + ` third &amp; only`,
                            },
                            {
                                key: `Mars`,
                                title: `Mars`,
                                excerpt: `&#39;Red&#39; planet`,
                            },
                            { title: `No key` },
                        ],
                    },
                    calls: string[] = [];
                await withFetch(async input => {
                    calls.push(`${input}`);
                    return jsonResponse(body);
                }, async () => {
                    const results = await wikipediaResults(
                        searchSettings({ limit: 2 }),
                        `earth & mars`,
                    );
                    assertEqual(results.length, 2, `two pages`);
                    assertEqual(
                        calls[0],
                        `https://en.wikipedia.org/w/rest.php/v1/search/page`
                            + `?q=earth%20%26%20mars&limit=2`,
                        `wikipedia url`,
                    );
                    assertEqual(results[0].title, `Earth`, `title`);
                    assertEqual(
                        results[0].url,
                        `https://en.wikipedia.org/wiki/Earth`,
                        `url`,
                    );
                    assertEqual(
                        results[0].snippet,
                        `Third planet Earth is the third & only`,
                        `snippet`,
                    );
                    assertEqual(results[1].snippet, `'Red' planet`, `entity snippet`);
                });
                assertEqual(searchSettings({ language: `de` }).language, `de`, `language`);
                assertEqual(searchSettings({ language: `pt-BR` }).language, `pt-BR`, `region`);
                assertEqual(
                    searchSettings({ language: `not a language` }).language,
                    `en`,
                    `language fallback`,
                );
                assertEqual(searchSettings().limit, 3, `default limit`);
                assertEqual(searchSettings({ limit: 100 }).limit, 20, `max limit`);
                assertEqual(searchSettings({ limit: 0 }).limit, 1, `min limit`);
                assertEqual(searchSettings().snippetLength, 400, `default snippet`);
                assertEqual(
                    searchSettings({ snippetLength: 9000 }).snippetLength,
                    4000,
                    `max snippet`,
                );
                assertEqual(searchSettings().timeout, 8000, `default timeout`);
                assertEqual(searchSettings({ timeout: 10 }).timeout, 1000, `min timeout`);
                assertEqual(
                    searchSettings({ provider: WebSearchProvider.duckduckgo }).provider,
                    WebSearchProvider.duckduckgo,
                    `provider`,
                );
                await withFetch(async () => jsonResponse(body), async () => {
                    const results = await wikipediaResults(
                        searchSettings({ snippetLength: 10 }),
                        `x`,
                    );
                    assertEqual(results[0].snippet, `Third plan`, `snippet cap`);
                });
                const tool = webSearchTool();
                assertEqual(tool.name, `websearch`, `tool name`);
                assertEqual(
                    tool.description,
                    `Search Wikipedia and return a few matching articles.`,
                    `wikipedia description`,
                );
                assertEqual(tool.parameters?.required?.[0], `query`, `required`);
            },
        },
        {
            name: `tools/search duckduckgo`,
            run: async () => {
                const
                    calls: string[] = [],
                    body = {
                        Heading: `Earth`,
                        AbstractText: `Third planet <b>from</b> the Sun`,
                        AbstractURL: `https://example.com/earth`,
                        Results: [
                            { FirstURL: `https://example.com/earth`, Text: `duplicate` },
                            { FirstURL: `https://example.com/moon`, Text: `The Moon` },
                        ],
                        RelatedTopics: [
                            { FirstURL: `https://example.com/mars`, Text: `Mars` },
                            {
                                Topics: [
                                    { FirstURL: `https://example.com/sun`, Text: `The Sun` },
                                ],
                            },
                        ],
                    },
                    settings = searchSettings({
                        provider: WebSearchProvider.duckduckgo,
                        limit: 10,
                    });
                await withFetch(async input => {
                    calls.push(`${input}`);
                    return jsonResponse(body);
                }, async () => {
                    const results = await duckDuckGoResults(settings, `planet`);
                    assertEqual(
                        calls[0],
                        `https://api.duckduckgo.com/?format=json&no_html=1`
                            + `&skip_disambig=1&q=planet`,
                        `duckduckgo url`,
                    );
                    assertEqual(results.length, 4, `deduplicated hits`);
                    assertEqual(results[0].title, `Earth`, `abstract heading`);
                    assertEqual(
                        results[0].snippet,
                        `Third planet from the Sun`,
                        `abstract text`,
                    );
                    assertEqual(results[1].url, `https://example.com/moon`, `result url`);
                    assertEqual(results[2].url, `https://example.com/mars`, `topic url`);
                    assertEqual(results[3].url, `https://example.com/sun`, `nested topic`);
                    const capped = await duckDuckGoResults(
                        searchSettings({
                            provider: WebSearchProvider.duckduckgo,
                            limit: 1,
                        }),
                        `planet`,
                    );
                    assertEqual(capped.length, 1, `limit cap`);
                });
                await withFetch(async () => jsonResponse({}), async () => {
                    const results = await duckDuckGoResults(settings, `nothing`);
                    assertEqual(results.length, 0, `empty answer`);
                });
                assertEqual(
                    webSearchTool({ provider: WebSearchProvider.duckduckgo }).description,
                    `Search DuckDuckGo for an instant answer and related topics.`,
                    `duckduckgo description`,
                );
            },
        },
        {
            name: `tools/search errors`,
            run: async () => {
                const fail = () => errorOf(
                    () => wikipediaResults(
                        searchSettings({ timeout: 1000 }),
                        `x`,
                    ),
                );
                let message = ``;
                await withFetch(
                    async () => new Response(`no`, { status: 500 }),
                    async () => { message = await fail(); },
                );
                assertEqual(message, `Search failed with 500`, `status error`);
                await withFetch(
                    (_input, init) => new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener(
                            `abort`,
                            () => reject(new DOMException(`Aborted`, `AbortError`)),
                            { once: true },
                        );
                    }),
                    async () => { message = await fail(); },
                );
                assertEqual(message, `Search timed out after 1000 ms`, `timeout error`);
            },
        },
        {
            name: `tools/currency rates`,
            run: async () => {
                const
                    fetchedAt = 1760000000000,
                    feed = {
                        rates: {
                            date: fetchedAt,
                            current: {
                                USD: 1.1,
                                GBP: 0.85,
                                CHF: 0.95,
                                XAU: 0.00003,
                                XPT: 0,
                            },
                            yesterday: {
                                USD: 1.05,
                                GBP: 0.86,
                                XAU: 0.000031,
                                XPT: 0,
                            },
                        },
                        coins: {
                            BTC: { pr: 60000, yst: 58000 },
                            ETH: { pr: 2500, yst: 2600 },
                            USD: { pr: 0.9, yst: 0.91 },
                            SOL: { pr: 100 },
                        },
                        date: fetchedAt + 3600000,
                    };
                resetPrices();
                clearPriceStorage();
                await withFetch(async () => jsonResponse(feed), async () => {
                    const fiat = await convert({ from: `gbp`, amount: 100 });
                    assertEqual(fiat.from, `GBP`, `upper case`);
                    assertEqual(fiat.to, `EUR`, `default target`);
                    assertEqual(fiat.amount, 100, `amount`);
                    assertEqual(fiat.rate, 1.1764706, `fiat rate`);
                    assertEqual(fiat.previousRate, 1.1627907, `fiat previous`);
                    assertEqual(fiat.change, 0.013679891, `fiat change`);
                    assertEqual(fiat.changePercent, 1.176, `fiat percent`);
                    assertEqual(fiat.result, 117.64706, `fiat result`);
                    assertEqual(fiat.stale, false, `not stale`);
                    assertEqual(
                        fiat.updatedAt,
                        new Date(fetchedAt).toISOString(),
                        `fiat source time`,
                    );
                    const coin = await convert({ from: `USD` });
                    assertEqual(coin.rate, 0.9, `crypto wins over fiat`);
                    assertEqual(coin.changePercent, -1.099, `coin percent`);
                    const btc = await convert({ from: `BTC` });
                    assertEqual(btc.rate, 60000, `crypto price`);
                    assertEqual(btc.previousRate, 58000, `crypto previous`);
                    assertEqual(btc.change, 2000, `crypto change`);
                    assertEqual(btc.changePercent, 3.448, `crypto percent`);
                    assertEqual(
                        btc.updatedAt,
                        new Date(feed.date).toISOString(),
                        `crypto source time`,
                    );
                    const cross = await convert({ from: `BTC`, to: `USD`, amount: 0.5 });
                    assertEqual(cross.rate, 66666.667, `cross rate`);
                    assertEqual(cross.result, 33333.333, `cross result`);
                    assertEqual(
                        cross.updatedAt,
                        new Date(feed.date).toISOString(),
                        `crypto only source time`,
                    );
                    const mixed = await convert({ from: `BTC`, to: `GBP` });
                    assertEqual(
                        mixed.updatedAt,
                        new Date(fetchedAt).toISOString(),
                        `oldest source time`,
                    );
                    const metal = await convert({ from: `XAU`, amount: 2 });
                    assertEqual(metal.rate, 33333.333, `metal rate`);
                    assertEqual(metal.result, 66666.667, `metal result`);
                    const sol = await convert({ from: `SOL` });
                    assertEqual(sol.previousRate, undefined, `no coin previous`);
                    const chf = await convert({ from: `CHF` });
                    assertEqual(chf.previousRate, undefined, `no fiat previous`);
                    const same = await convert({ from: `eur`, to: `eur`, amount: 5 });
                    assertEqual(same.rate, 1, `same currency rate`);
                    assertEqual(same.change, 0, `same currency change`);
                    assertEqual(same.changePercent, 0, `same currency percent`);
                    assertEqual(same.result, 5, `same currency result`);
                });
                await withFetch(async () => jsonResponse(feed), async () => {
                    assertEqual(
                        await errorOf(() => convert({ from: `XPT` })),
                        `Unavailable quote for XPT`,
                        `unavailable metal`,
                    );
                    assertEqual(
                        await errorOf(() => convert({ from: `ZZZ` })),
                        `Unknown symbol ZZZ`,
                        `unknown symbol`,
                    );
                    assertEqual(
                        await errorOf(() => convert({ from: `GBP`, amount: `x` as never })),
                        `Invalid amount`,
                        `bad amount`,
                    );
                    assertEqual(
                        await errorOf(() => convert({})),
                        `Missing from`,
                        `missing from`,
                    );
                    assertEqual(
                        await errorOf(() => convert({ from: `GBP`, to: `` })),
                        `Missing to`,
                        `missing to`,
                    );
                });
            },
        },
        {
            name: `tools/currency cache`,
            run: async () => {
                const
                    feed = (price: number, chf: number) => ({
                        rates: {
                            date: 1760000000000,
                            current: { GBP: 0.85, CHF: chf },
                            yesterday: { GBP: 0.86, CHF: chf },
                        },
                        coins: { BTC: { pr: price, yst: price } },
                        date: 1760003600000,
                    }),
                    clock = withClock(1760000000000);
                let fetches = 0;
                const response = async () => {
                    fetches += 1;
                    return jsonResponse(fetchCount(fetches));
                };
                const fetchCount = (count: number) => count == 1
                    ? feed(60000, 0.95)
                    : feed(70000, 2);
                try {
                    resetPrices();
                    clearPriceStorage();
                    await withFetch(response, async () => {
                        const first = await convert({ from: `BTC` });
                        assertEqual(first.rate, 60000, `first price`);
                        await convert({ from: `BTC` });
                        assertEqual(fetches, 1, `one fetch inside the ttl`);
                        clock.at(clock.now() + 4 * 60_000);
                        await convert({ from: `BTC` });
                        assertEqual(fetches, 1, `crypto fresh at four minutes`);
                        clock.at(clock.now() + 2 * 60_000);
                        const next = await convert({ from: `BTC` });
                        assertEqual(fetches, 2, `crypto refetched after five minutes`);
                        assertEqual(next.rate, 70000, `new coin price`);
                        const fiat = await convert({ from: `CHF` });
                        assertEqual(fetches, 2, `fiat still fresh`);
                        assertEqual(fiat.rate, 1.0526316, `crypto refresh kept fiat`);
                        clock.at(clock.now() + 55 * 60_000);
                        const hourly = await convert({ from: `CHF` });
                        assertEqual(fetches, 3, `fiat refetched after an hour`);
                        assertEqual(hourly.rate, 0.5, `new fiat price`);
                    });
                    resetPrices();
                    clearPriceStorage();
                    fetches = 0;
                    await withFetch(response, async () => {
                        const values = await Promise.all([
                            convert({ from: `BTC` }),
                            convert({ from: `GBP` }),
                        ]);
                        assertEqual(fetches, 1, `one shared fetch`);
                        assertEqual(values[0].rate, 60000, `shared coin`);
                        assertEqual(values[1].rate, 1.1764706, `shared fiat`);
                        assertEqual(
                            JSON.stringify(sectionsFor([`USD`])),
                            `{"fiat":true,"crypto":true}`,
                            `unknown symbol needs both`,
                        );
                        assertEqual(
                            JSON.stringify(sectionsFor([`GBP`])),
                            `{"fiat":true,"crypto":false}`,
                            `fiat symbol`,
                        );
                        assertEqual(
                            JSON.stringify(sectionsFor([`BTC`])),
                            `{"fiat":false,"crypto":true}`,
                            `crypto symbol`,
                        );
                        assertEqual(
                            JSON.stringify(sectionsFor([`EUR`])),
                            `{"fiat":false,"crypto":false}`,
                            `base symbol`,
                        );
                    });
                } finally {
                    clock.done();
                };
            },
        },
        {
            name: `tools/currency failure`,
            run: async () => {
                const
                    feed = {
                        rates: {
                            date: 1760000000000,
                            current: { GBP: 0.85 },
                            yesterday: { GBP: 0.86 },
                        },
                        coins: { BTC: { pr: 60000, yst: 58000 } },
                        date: 1760003600000,
                    },
                    clock = withClock(1760000000000);
                let failed = 0;
                const failing = async () => {
                    failed += 1;
                    throw new Error(`offline`);
                };
                try {
                    resetPrices();
                    clearPriceStorage();
                    await withFetch(async () => jsonResponse(feed), async () => {
                        await convert({ from: `BTC` });
                    });
                    clock.at(clock.now() + 10 * 60_000);
                    await withFetch(failing, async () => {
                        const cached = await convert({ from: `BTC` });
                        assertEqual(cached.rate, 60000, `cached price kept`);
                        assertEqual(cached.stale, true, `stale flag`);
                        assertEqual(failed, 1, `one attempt`);
                        await convert({ from: `BTC` });
                        assertEqual(failed, 1, `backoff holds`);
                        clock.at(clock.now() + 31_000);
                        await convert({ from: `BTC` });
                        assertEqual(failed, 2, `retried after the backoff`);
                    });
                    resetPrices();
                    clearPriceStorage();
                    await withFetch(failing, async () => {
                        assertEqual(
                            await errorOf(() => convert({ from: `BTC` })),
                            `Prices unavailable offline`,
                            `no cache and no network`,
                        );
                    });
                } finally {
                    clock.done();
                };
            },
        },
        {
            name: `tools/currency offline`,
            run: async () => {
                const
                    feed = {
                        rates: {
                            date: 1760000000000,
                            current: { GBP: 0.85 },
                            yesterday: {},
                        },
                        coins: { BTC: { pr: 60000, yst: 58000 } },
                        date: 1760003600000,
                    },
                    clock = withClock(1760000000000),
                    nav = navigator as Navigator & { onLine: boolean };
                let fetches = 0;
                try {
                    resetPrices();
                    clearPriceStorage();
                    await withFetch(async () => {
                        fetches += 1;
                        return jsonResponse(feed);
                    }, async () => {
                        await convert({ from: `BTC` });
                        Object.defineProperty(nav, `onLine`, {
                            configurable: true,
                            value: false,
                        });
                        clock.at(clock.now() + 10 * 60_000);
                        const offline = await convert({ from: `BTC` });
                        assertEqual(fetches, 1, `offline skips the fetch`);
                        assertEqual(offline.rate, 60000, `offline price`);
                        assertEqual(offline.stale, false, `offline is not stale`);
                    });
                } finally {
                    delete (nav as { onLine?: boolean }).onLine;
                    clock.done();
                };
            },
        },
        {
            name: `tools/currency storage`,
            run: async () => {
                const
                    feed = {
                        rates: {
                            date: 1760000000000,
                            current: { GBP: 0.85 },
                            yesterday: { GBP: 0.86 },
                        },
                        coins: { BTC: { pr: 60000, yst: 58000 } },
                        date: 1760003600000,
                    },
                    clock = withClock(1760000000000);
                try {
                    resetPrices();
                    clearPriceStorage();
                    await withFetch(async () => jsonResponse(feed), async () => {
                        await convert({ from: `BTC` });
                    });
                    const saved = JSON.parse(
                        localStorage.getItem(priceStorageKey) ?? `{}`,
                    ) as PriceSnapshot;
                    assertEqual(saved.crypto?.prices?.BTC, 60000, `saved crypto`);
                    assertEqual(saved.fiat?.rates?.GBP, 0.85, `saved fiat`);
                    resetPrices();
                    let fetches = 0;
                    await withFetch(async () => {
                        fetches += 1;
                        throw new Error(`offline`);
                    }, async () => {
                        const hydrated = await convert({ from: `BTC` });
                        assertEqual(hydrated.rate, 60000, `hydrated price`);
                        assertEqual(hydrated.stale, false, `hydrated freshness`);
                        assertEqual(fetches, 0, `no fetch inside the ttl`);
                    });
                    resetPrices();
                    await withFetch(async () => jsonResponse(feed), async () => {
                        await convert({ from: `BTC` });
                    });
                    clock.at(clock.now() + 6 * 60_000);
                    await withFetch(
                        async () => jsonResponse({
                            ...feed,
                            date: feed.date - 60_000,
                            coins: { BTC: { pr: 1, yst: 1 } },
                        }),
                        async () => {
                            const newer = await convert({ from: `BTC` });
                            assertEqual(newer.rate, 60000, `newer source kept`);
                        },
                    );
                } finally {
                    clock.done();
                    clearPriceStorage();
                };
            },
        },
        {
            name: `tools/registry`,
            run: () => {
                assertEqual(builtinTools([]).length, 0, `no tools`);
                const
                    all = builtinTools([
                        BuiltinTool.websearch,
                        BuiltinTool.calculate,
                        BuiltinTool.currency,
                    ]),
                    names = all.map(tool => tool.name).join(`,`);
                assertEqual(names, `websearch,calculate,currency`, `registry order`);
                assertEqual(
                    builtinTools([BuiltinTool.currency, BuiltinTool.websearch])
                        .map(tool => tool.name).join(`,`),
                    `currency,websearch`,
                    `registry selection`,
                );
                assertEqual(all[1], calculateTool, `calculate kept`);
                assertEqual(all[2], currencyTool, `currency kept`);
                assertEqual(all[0].name, `websearch`, `websearch name`);
                assertEqual(webSearchTool().name, `websearch`, `search tool name`);
                assertEqual(
                    webSearchTool({
                        provider: WebSearchProvider.duckduckgo,
                    }).description,
                    `Search DuckDuckGo for an instant answer and related topics.`,
                    `search config`,
                );
                assertEqual(
                    toolNamed(`lookup`, () => 42).execute({}),
                    42,
                    `host tool runs`,
                );
            },
        },
        {
            name: `describe/logging`,
            run: async () => {
                const
                    logs: string[] = [],
                    original = console.log,
                    cpu = createFakeEngine({
                        backend: LlmBackend.cpu,
                        thinkingText: `thinking`,
                        chatText: `logged description`,
                        onChat: params => params.onSpeed?.(42),
                    }),
                    runtime = createRuntime({
                        engines: { cpu: cpu.engine },
                        backend: LlmBackend.cpu,
                    });
                console.log = (...args: unknown[]) => {
                    logs.push(args.map(value => `${value}`).join(` `));
                };
                try {
                    await createDescribeOn(runtime)({
                        targetLanguage: `en`,
                        images: [`one`],
                        logging: true,
                    });
                    assert(
                        logs.some(line => line.startsWith(`Describe start`)),
                        `describe start log`,
                    );
                    assert(
                        logs.some(line => line.includes(`Describe english`)),
                        `describe english log`,
                    );
                    assert(
                        logs.some(line => line.includes(`logged description`)),
                        `description log`,
                    );
                    assert(
                        logs.some(line => line.includes(`Describe reason`)),
                        `reason log`,
                    );
                    assert(
                        logs.some(line => line.includes(`Describe text`)),
                        `text log`,
                    );
                    assert(
                        logs.some(line => line.includes(`Describe speed`)),
                        `speed log`,
                    );
                    logs.length = 0;
                    await createDescribeOn(runtime)({
                        targetLanguage: `en`,
                        images: [`one`],
                    });
                    assertEqual(logs.length, 0, `logs stay off`);
                } finally {
                    console.log = original;
                };
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
