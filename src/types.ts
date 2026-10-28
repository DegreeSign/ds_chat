import type {
    ChatModelId,
    ChatStatus,
    LlmBackend,
    LlmPhase,
    LlmRole,
    LlmStatus,
    WebSearchProvider,
} from './enums';

/** One chat message, owned by the host */
interface ChatMessage {
    role: LlmRole,
    content: string,
    /** Image data URLs or URLs attached to the turn */
    images?: string[],
    /** Audio data URLs or URLs attached to the turn */
    audio?: string[],
}

/** One JSON-safe value passed to or returned from a tool */
type ChatToolValue =
    | string
    | number
    | boolean
    | null
    | ChatToolValue[]
    | { [key: string]: ChatToolValue };

/** The JSON-schema subset the model reads for a tool parameter */
interface ChatToolSchema {
    type?: `object` | `array` | `string` | `number` | `integer`
        | `boolean` | `null`,
    description?: string,
    properties?: Record<string, ChatToolSchema>,
    required?: string[],
    items?: ChatToolSchema,
    enum?: string[],
}

/** One tool a host may run itself, never handed to the model */
interface ChatTool {
    /** Unique tool name */
    name: string,
    /** What the tool does */
    description?: string,
    parameters?: ChatToolSchema,
    execute: (
        args: Record<string, ChatToolValue>,
    ) => ChatToolValue | Promise<ChatToolValue>,
}

/** One tool call, with its parsed arguments */
interface ChatToolCall {
    id: number,
    name: string,
    arguments: Record<string, ChatToolValue>,
}

/** One finished tool call, carrying its value or its error */
interface ChatToolResult extends ChatToolCall {
    result?: ChatToolValue,
    error?: string,
}

/** Search provider settings of the websearch tool */
interface WebSearchConfig {
    provider?: WebSearchProvider,
    /** Wikipedia language edition, two or three letters plus an optional region */
    language?: string,
    /** Results asked of the provider, 1 to 20 */
    limit?: number,
    /** Characters kept per snippet */
    snippetLength?: number,
    /** Request budget in milliseconds */
    timeout?: number,
}

/** One search hit returned by the websearch tool */
interface WebSearchResult {
    title: string,
    url: string,
    snippet: string,
}

/** Websearch settings with every default and clamp resolved */
interface WebSearchSettings {
    provider: WebSearchProvider,
    language: string,
    limit: number,
    snippetLength: number,
    timeout: number,
}

/** Fiat and metal rates of one feed fetch, quoted per EUR */
interface FiatSnapshot {
    /** Local fetch time, milliseconds */
    fetchedAt: number,
    /** Feed timestamp, milliseconds */
    sourceAt: number,
    rates: Record<string, number>,
    yesterday: Record<string, number>,
}

/** Crypto prices of one feed fetch, quoted in EUR per unit */
interface CryptoSnapshot {
    fetchedAt: number,
    sourceAt: number,
    prices: Record<string, number>,
    yesterday: Record<string, number>,
}

/** The price sections held in memory and in localStorage */
interface PriceSnapshot {
    fiat?: FiatSnapshot,
    crypto?: CryptoSnapshot,
}

/** Price sections one request has to read */
interface PriceSections {
    fiat: boolean,
    crypto: boolean,
}

/** One conversion returned by the currency tool */
interface CurrencyResult {
    from: string,
    to: string,
    amount: number,
    rate: number,
    previousRate?: number,
    change?: number,
    changePercent?: number,
    result: number,
    updatedAt: string,
    stale: boolean,
}

/** One evaluated arithmetic expression */
interface CalculationResult {
    /** Normalized expression that was evaluated */
    expression: string,
    result: number,
}

/** One page of a Wikipedia search response */
interface WikipediaPage {
    key?: string,
    title?: string,
    description?: string,
    excerpt?: string,
}

/** One Wikipedia search response */
interface WikipediaResponse {
    pages?: WikipediaPage[],
}

/** One DuckDuckGo topic, a group carries nested topics */
interface DuckDuckGoTopic {
    FirstURL?: string,
    Text?: string,
    Topics?: DuckDuckGoTopic[],
}

/** One DuckDuckGo instant answer response */
interface DuckDuckGoResponse {
    Heading?: string,
    AbstractText?: string,
    AbstractURL?: string,
    Results?: DuckDuckGoTopic[],
    RelatedTopics?: DuckDuckGoTopic[],
}

/** One crypto row of the price feed */
interface PriceCoin {
    /** Price in EUR per unit */
    pr?: number,
    /** Price in EUR per unit, 24 hours earlier */
    yst?: number,
}

/** The CoinExams price feed, validated before use */
interface PriceFeed {
    rates?: {
        /** Feed timestamp of the fiat and metal rates, milliseconds */
        date?: number,
        /** Units of each symbol per EUR */
        current?: Record<string, number>,
        /** The same rates, 24 hours earlier */
        yesterday?: Record<string, number>,
    },
    coins?: Record<string, PriceCoin>,
    /** Feed timestamp of the crypto prices, milliseconds */
    date?: number,
}

/** One on-device model */
interface ChatModel {
    /** Stable catalog id, passed by the host */
    id: ChatModelId,
    /** Whether the model supports chain-of-thought reasoning */
    reasoning: boolean,
    /** wllama (CPU) artifact */
    cpu?: {
        repo: string,
        file: string,
        /** Vision projector, present when the CPU build accepts images */
        mmproj?: {
            file: string,
            /** Whether the projector also accepts audio */
            audio?: boolean,
        },
    },
    /** LiteRT-LM (WebGPU) artifact */
    litert?: {
        repo: string,
        /** File name inside the model repository */
        file: string,
        /** Whether the build accepts images */
        vision: boolean,
        /** Whether the build accepts audio */
        audio: boolean,
    },
}

/** Token, prompt and thread budgets of an on-device generation */
interface LlmLimits {
    /** Max answer tokens */
    maxReplyTokens: number,
    /** Max chain-of-thought tokens, used by the CPU engine when it loads */
    maxThinkingTokens: number,
    /** Total output budget when reasoning is on, thought plus answer */
    maxReasoningTokens: number,
    /** Max images sent in one prompt */
    maxImages: number,
    /** Max audio clips sent in one prompt */
    maxAudio: number,
    /** Max characters kept per message */
    maxContentLength: number,
    /** Max characters of the whole prompt */
    promptCharBudget: number,
    /** Max CPU threads, applied after the hardware maximum */
    maxThreads: number,
}

/** Current model and request state reported to the host */
interface ChatStatusSnapshot {
    /** Build that runs on this device after the mobile swap */
    model?: ChatModelId,
    /** Availability derived from the engine status */
    availability: ChatStatus,
    status: LlmStatus,
    backend: LlmBackend,
    /** Whether the requested model accepts images on this backend */
    supportsImages: boolean,
    /** Whether the requested model accepts audio on this backend */
    supportsAudio: boolean,
    ready: boolean,
    loading: boolean,
    /** Whether a reply is streaming right now */
    requesting: boolean,
    phase: LlmPhase,
    /** Download or load progress, 0..100 */
    percent: number,
    /** Last request error, cleared when a reply starts */
    error?: string,
}

/** One chat request, invoked for every response */
interface ChatInput {
    /** Model that answers, the GPU model when WebGPU is available, else the CPU one */
    model?: ChatModelId,
    /** Complete prompt, including the system and user turns */
    messages: ChatMessage[],
    /** Override any token, prompt or thread budget */
    limits?: Partial<LlmLimits>,
    /** Whether the model may use chain-of-thought reasoning, defaults to off */
    reasoning?: boolean,
    /** Whether package and engine logs reach the console, defaults to off */
    logging?: boolean,
    /** Accumulated reasoning text, streamed while the model thinks */
    onThinking?: (text: string) => void,
    /** Accumulated reply text, streamed while the model answers */
    onResponse: (text: string) => void,
    /** Current generation speed in tokens per second, streamed while the model answers */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Model and request state, reported on every change */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
}

/** Model preload request, a subset of ChatInput */
type ChatPreloadInput = Pick<ChatInput, `model` | `limits` | `logging` | `onStatus`>;

/** Stop the current request, its model load, or free the loaded model */
type CancelChat = () => void;

/** One image described in English and in the requested language */
interface ImageDescription {
    /** Description produced by the vision model */
    descriptionEN: string,
    /** Translation of the English description, English itself without a GPU */
    description: string,
    /** Time the describer took for this image, milliseconds */
    durationMs: number,
}

/** One batch image description request */
interface DescribeImagesInput {
    /** Language the description is translated into, English skips translation */
    targetLanguage: string,
    /** Image data URLs or URLs, described one by one in this order */
    images: string[],
    /** Index of the image being processed and each description once ready */
    currentIndex?: (
        index: number,
        descriptionEN?: string,
        description?: string,
        durationMs?: number,
    ) => void,
    /** Override any token, prompt or thread budget */
    limits?: Partial<LlmLimits>,
    /** Whether package and engine logs reach the console, defaults to off */
    logging?: boolean,
    /** Model and request state, reported on every change */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
}

/** wllama wasm assets used by the CPU engine */
interface WllamaAssets {
    /** URL of the wllama wasm binary */
    wasm: string,
    /** URL of the wllama compat wasm binary */
    compatWasm: string,
    /** URL of the wllama compat worker script */
    compatWorker: string,
}

/** LiteRT-LM wasm assets used by the GPU engine */
interface LitertAssets {
    /** URL of the LiteRT-LM wasm glue script */
    script: string,
    /** URL of the LiteRT-LM wasm binary */
    wasm: string,
}

/** Navigator with the WebGPU entry point, absent in Node */
interface GpuNavigator extends Navigator {
    gpu?: {
        /** Ask the browser for a WebGPU adapter */
        requestAdapter: (options?: {
            powerPreference?: `low-power` | `high-performance`,
        }) => Promise<unknown>,
    },
}

/** Navigator fields that tell a phone or tablet from a desktop */
type MobileNavigator = Pick<Navigator, `userAgent` | `maxTouchPoints`> & {
    /** Chromium client hints, the reliable mobile flag */
    userAgentData?: { mobile?: boolean },
};

/** Request state that builds one status snapshot */
interface ChatState {
    /** Whether a reply is streaming right now */
    requesting: boolean,
    phase: LlmPhase,
    /** Download or load progress, 0..100 */
    percent: number,
    /** Last request error, cleared when a reply starts */
    error?: string,
}

/** One live chat request */
interface ActiveCall extends ChatState {
    token: number,
    input: ChatInput,
    controller: AbortController,
    cancelled: boolean,
    /** Model resolved for this call */
    model?: ChatModelId,
}

/** Engine and backend overrides used by tests */
interface RuntimeDeps {
    engines?: { cpu?: LlmEngine, litert?: LlmEngine },
    backend?: LlmBackend,
}

/** One model load request */
interface RuntimeLoadParams {
    model: ChatModel,
    limits: LlmLimits,
    assets?: Partial<WllamaAssets>,
    /** Whether engine logs reach the console */
    logging?: boolean,
    /** Stop waiting for this load, the download continues while another caller waits */
    signal?: AbortSignal,
    onProgress: (progress: number, phase: LlmPhase) => void,
}

/** One caller waiting on an in-flight model load */
interface RuntimeLoadWaiter {
    /** Report load progress to this caller */
    report: RuntimeLoadParams[`onProgress`],
    /** Resolve this caller, early when it leaves the load */
    settle: (loaded: boolean) => void,
}

/** Bytes of one model file already stored on disk */
interface StoredPart {
    /** Bytes already stored */
    size: number,
    /** Full file size, zero while unknown */
    total: number,
    /** Entity tag of the stored bytes, empty when the host hides it */
    etag: string,
}

/** One part file of a model, at its byte offset */
interface StoredFilePart {
    /** Byte offset of the part in the model file */
    start: number,
    /** Bytes stored in the part */
    size: number,
}

/** One stored model file, complete or still downloading */
interface StoredModel extends StoredPart {
    /** The stored bytes, a snapshot of the parts on disk */
    file: Blob,
    /** Whether every byte of the total is stored */
    complete: boolean,
}

/** Download metadata kept beside one stored model file */
interface StoredModelMeta {
    total: number,
    etag: string,
    complete: boolean,
}

/** Where one response continues a stored part */
interface ResumePlan {
    /** Byte the response body starts at */
    start: number,
    /** Full file size, zero while unknown */
    total: number,
    etag: string,
}

/** One model file download into the store */
interface StoreDownloadParams {
    url: string,
    /** Stop the download, the bytes stored so far are kept */
    signal?: AbortSignal,
    onProgress: StartLlmParams[`onProgress`],
}

/** Resumable model file store owned by one engine */
interface ModelStore {
    /** Stored bytes and metadata of one model file, undefined when absent */
    stored: (url: string) => Promise<StoredModel | undefined>,
    /** Download one model file, resuming the parts already stored */
    download: (params: StoreDownloadParams) => Promise<StoredModel | undefined>,
    /** Delete one stored model file and its metadata */
    remove: (url: string) => Promise<void>,
    /** Delete the whole store directory and every model file in it */
    purge: () => Promise<void>,
}

/** One generation request */
interface RuntimeChatParams {
    messages: ChatMessage[],
    limits: LlmLimits,
    reasoning: boolean,
    /** Whether engine logs reach the console */
    logging?: boolean,
    onReason: (text: string) => void,
    onText: (text: string) => void,
    /** Current generation speed in tokens per second */
    onSpeed?: (tokensPerSecond: number) => void,
    signal?: AbortSignal,
}

/** On-device runtime shared by every request */
interface Runtime {
    /** Load a model, or join a load of the same model already in flight */
    load: (params: RuntimeLoadParams) => Promise<boolean>,
    chat: (params: RuntimeChatParams) => Promise<string | undefined>,
    unload: () => Promise<void>,
    /** Release the model and delete every cached model file */
    clear: () => Promise<void>,
    ready: () => boolean,
    loading: () => boolean,
    status: () => LlmStatus,
    backend: () => LlmBackend,
    /** Last model load error, cleared when a load starts */
    error: () => string | undefined,
    /** Model currently loaded on this runtime */
    model: () => ChatModel | undefined,
}

/** Params for a single on-device chat generation */
interface EngineChatParams {
    messages: ChatMessage[],
    limits: LlmLimits,
    /** User preference, off unless explicitly turned on */
    reasoning: boolean,
    /** Whether engine logs reach the console */
    logging?: boolean,
    /** Streamed reasoning delta */
    onReason: (text: string) => void,
    /** Streamed reply delta */
    onText: (text: string) => void,
    /** Current generation speed in tokens per second */
    onSpeed?: (tokensPerSecond: number) => void,
    signal?: AbortSignal,
}

/** Params of the engine startLLM */
interface StartLlmParams {
    model: ChatModel,
    /** Engine-level budgets, read when the model loads */
    limits: LlmLimits,
    /** Report download and load progress 0..1 */
    onProgress: (progress: number, phase?: LlmPhase) => void,
    /** Stop a download or load that is no longer wanted */
    signal?: AbortSignal,
    /** Whether engine logs reach the console */
    logging?: boolean,
    /** CPU engine asset override */
    assets?: Partial<WllamaAssets>,
}

/** Unified object returned by the engine startLLM */
interface LlmRuntime {
    /** Model this runtime serves */
    model: ChatModel,
    /** Backend that accepted the model */
    backend: LlmBackend,
    /** Context window requested from the engine */
    contextSize: number,
    /** Stream one reply, returning the final text or undefined when stopped */
    chat: (params: EngineChatParams) => Promise<string | undefined>,
    /** Release the model from memory, keeping its cache */
    unload: () => Promise<void>,
}

/** A model runner backed by one inference engine */
interface LlmEngine {
    backend: LlmBackend,
    /** Download (if needed) and load a model, returning its runtime */
    startLLM: (params: StartLlmParams) => Promise<LlmRuntime>,
    /** Whether the model files are already fully stored on this device */
    cached: (model: ChatModel) => Promise<boolean>,
    /** Delete every on-device artifact this engine keeps, including orphans */
    purge: () => Promise<void>,
}

/** One text, image or audio segment of a user turn */
type EngineContentPart =
    | { type: `text`, text: string }
    | { type: `image`, url: string }
    | { type: `audio`, url: string };

/** One wllama content segment */
type WllamaContentPart =
    | { type: `text`, text: string }
    | { type: `image`, data: ArrayBuffer }
    | { type: `audio`, data: ArrayBuffer };

/** One wllama chat turn */
type WllamaMessage =
    | { role: `system`, content: string }
    | { role: `user`, content: string | WllamaContentPart[] }
    | { role: `assistant`, content: string };

/** One OpenAI-style message, a user turn may carry media parts */
type EngineMessage =
    | { role: `system`, content: string }
    | { role: `user`, content: string | EngineContentPart[] }
    | { role: `assistant`, content: string };

/** One LiteRT-LM content segment */
type LitertContentPart = import('@litert-lm/core').ContentPart;

/** One LiteRT-LM chat turn */
type LitertMessage = import('@litert-lm/core').Message;

/** One LiteRT-LM engine */
type LitertEngine = import('@litert-lm/core').Engine;

/** The LiteRT-LM module namespace */
type LitertModule = typeof import('@litert-lm/core');

/** Settings handed to the LiteRT-LM engine */
type LitertSettings = import('@litert-lm/core').EngineSettings;

/** Params of one LiteRT-LM settings build */
interface LitertSettingsParams {
    /** Model with the artifact */
    model: ChatModel,
    /** Image and context budgets */
    limits: LlmLimits,
    /** Model file stream */
    source: ReadableStream<Uint8Array>,
    /** Loaded LiteRT module */
    mod: LitertModule,
}

/** One reused LiteRT-LM conversation and the turns it already holds */
interface LitertSession {
    /** Live conversation, dropped when a turn cannot be continued */
    conversation?: import('@litert-lm/core').Conversation,
    /** Built turns already sent to the conversation */
    sent: EngineMessage[],
    /** Reasoning flag the conversation was created with */
    reasoning: boolean,
    /** Output token budget the conversation was created with */
    maxTokens: number,
}

/** Params of one LiteRT-LM chat call */
interface LitertChatParams {
    engine: LitertEngine,
    model: ChatModel,
    mod: LitertModule,
    params: EngineChatParams,
    session: LitertSession,
}

/** Params of one LiteRT-LM stream */
interface StreamLitertParams {
    engine: LitertEngine,
    mod: LitertModule,
    params: EngineChatParams,
    messages: EngineMessage[],
    session: LitertSession,
}

/** Streamed delta, reasoning may be inline or structured */
interface EngineDelta {
    content?: string,
    reasoning?: string,
    reasoning_content?: string,
}

/** Streamed chunk as the engine shapes it */
interface EngineChunk {
    choices?: Array<{ finish_reason?: string, delta?: EngineDelta }>,
}

/** Params of one streamed reply */
interface StreamReplyParams {
    model: ChatModel,
    /** Streamed reasoning delta */
    onReason: (text: string) => void,
    /** Streamed reply delta */
    onText: (text: string) => void,
    /** Current generation speed in tokens per second */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Open the engine stream for the prepared messages */
    start: () => Promise<AsyncIterable<unknown>>,
    /** Whether the caller stopped the generation */
    stopped: () => boolean,
    /** Whether engine logs reach the console */
    logging?: boolean,
    /** Budget before the first chunk arrives, milliseconds */
    firstTimeoutMs?: number,
    /** Budget between two chunks, milliseconds */
    idleTimeoutMs?: number,
    /** Called when a slow stream keeps the text already delivered */
    onStall?: () => void,
}

/** Params of one engine chat call */
interface EngineRunParams {
    model: ChatModel,
    params: EngineChatParams,
    /** Open the engine stream for the prepared messages */
    start: (messages: EngineMessage[]) => Promise<AsyncIterable<unknown>>,
    /** Whether the caller stopped the generation */
    stopped: () => boolean,
    /** Called when a slow stream keeps the text already delivered */
    onStall?: () => void,
}

export type {
    ChatMessage,
    ChatTool,
    ChatToolCall,
    ChatToolResult,
    ChatToolSchema,
    ChatToolValue,
    WebSearchConfig,
    WebSearchResult,
    WebSearchSettings,
    FiatSnapshot,
    CryptoSnapshot,
    PriceSnapshot,
    PriceSections,
    PriceCoin,
    PriceFeed,
    CurrencyResult,
    CalculationResult,
    WikipediaPage,
    WikipediaResponse,
    DuckDuckGoTopic,
    DuckDuckGoResponse,
    ChatModel,
    LlmLimits,
    ChatStatusSnapshot,
    ChatInput,
    ChatPreloadInput,
    ChatState,
    CancelChat,
    ImageDescription,
    DescribeImagesInput,
    WllamaAssets,
    LitertAssets,
    GpuNavigator,
    MobileNavigator,
    ActiveCall,
    RuntimeDeps,
    RuntimeLoadParams,
    RuntimeLoadWaiter,
    RuntimeChatParams,
    StoredPart,
    StoredFilePart,
    StoredModel,
    StoredModelMeta,
    ResumePlan,
    StoreDownloadParams,
    ModelStore,
    Runtime,
    EngineChatParams,
    StartLlmParams,
    LlmRuntime,
    LlmEngine,
    EngineMessage,
    EngineContentPart,
    WllamaContentPart,
    WllamaMessage,
    LitertContentPart,
    LitertMessage,
    LitertEngine,
    LitertModule,
    LitertSettings,
    LitertSettingsParams,
    LitertSession,
    LitertChatParams,
    StreamLitertParams,
    EngineDelta,
    EngineChunk,
    StreamReplyParams,
    EngineRunParams,
};
