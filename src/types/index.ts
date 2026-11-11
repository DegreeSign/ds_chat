import type {
    ChatModelId,
    ChatPreloadField,
    ChatStatus,
    DescriptionEnhancedStage,
    EstimateOperation,
    LlmBackend,
    LlmPhase,
    LlmRole,
    LlmStatus,
    WebSearchProvider,
} from './enums';

/** Host-owned chat message */
interface ChatMessage {
    role: LlmRole,
    content: string,
    /** Turn image URLs */
    images?: string[],
    /** Turn audio URLs */
    audio?: string[],
}

/** JSON-safe tool value */
type ChatToolValue =
    | string
    | number
    | boolean
    | null
    | ChatToolValue[]
    | { [key: string]: ChatToolValue };

/** Tool parameter JSON schema */
interface ChatToolSchema {
    type?: `object` | `array` | `string` | `number` | `integer`
        | `boolean` | `null`,
    description?: string,
    properties?: Record<string, ChatToolSchema>,
    required?: string[],
    items?: ChatToolSchema,
    enum?: string[],
}

/** Host-run tool */
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

/** Parsed tool call */
interface ChatToolCall {
    id: number,
    name: string,
    arguments: Record<string, ChatToolValue>,
}

/** Finished tool result */
interface ChatToolResult extends ChatToolCall {
    result?: ChatToolValue,
    error?: string,
}

/** Websearch provider settings */
interface WebSearchConfig {
    provider?: WebSearchProvider,
    /** Wikipedia language code */
    language?: string,
    /** Provider result count */
    limit?: number,
    /** Characters kept per snippet */
    snippetLength?: number,
    /** Request budget in milliseconds */
    timeout?: number,
}

/** Websearch result hit */
interface WebSearchResult {
    title: string,
    url: string,
    snippet: string,
}

/** Resolved websearch settings */
interface WebSearchSettings {
    provider: WebSearchProvider,
    language: string,
    limit: number,
    snippetLength: number,
    timeout: number,
}

/** Fiat and metal rates */
interface FiatSnapshot {
    /** Local fetch time, milliseconds */
    fetchedAt: number,
    /** Feed timestamp, milliseconds */
    sourceAt: number,
    rates: Record<string, number>,
    yesterday: Record<string, number>,
}

/** Crypto prices in EUR */
interface CryptoSnapshot {
    fetchedAt: number,
    sourceAt: number,
    prices: Record<string, number>,
    yesterday: Record<string, number>,
}

/** Cached price sections */
interface PriceSnapshot {
    fiat?: FiatSnapshot,
    crypto?: CryptoSnapshot,
}

/** Required price sections */
interface PriceSections {
    fiat: boolean,
    crypto: boolean,
}

/** Currency conversion result */
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

/** Wikipedia search page */
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

/** DuckDuckGo topic group */
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

/** Crypto price row */
interface PriceCoin {
    /** Price in EUR per unit */
    pr?: number,
    /** Price 24 hours ago */
    yst?: number,
}

/** Validated CoinExams feed */
interface PriceFeed {
    rates?: {
        /** Fiat feed timestamp */
        date?: number,
        /** Symbol units per EUR */
        current?: Record<string, number>,
        /** Rates 24 hours ago */
        yesterday?: Record<string, number>,
    },
    coins?: Record<string, PriceCoin>,
    /** Crypto feed timestamp */
    date?: number,
}

/** One on-device model */
interface ChatModel {
    /** Stable catalog id */
    id: ChatModelId,
    /** Model reasoning support */
    reasoning: boolean,
    /** wllama (CPU) artifact */
    cpu?: {
        repo: string,
        file: string,
        /** Optional pinned repository revision */
        revision?: string,
        /** Optional CPU vision projector */
        mmproj?: {
            /** Projector repository override */
            repo?: string,
            file: string,
            /** Optional pinned projector revision */
            revision?: string,
            /** Projector audio support */
            audio?: boolean,
        },
    },
    /** LiteRT-LM (WebGPU) artifact */
    litert?: {
        repo: string,
        /** Model repository file name */
        file: string,
        /** Optional pinned repository revision */
        revision?: string,
        /** Whether the build accepts images */
        vision: boolean,
        /** Whether the build accepts audio */
        audio: boolean,
    },
}

/** Generation budget settings */
interface LlmLimits {
    /** Max answer tokens */
    maxReplyTokens: number,
    /** Max reasoning tokens */
    maxThinkingTokens: number,
    /** Reasoning output budget */
    maxReasoningTokens: number,
    /** Max prompt images */
    maxImages: number,
    /** Vision tokens per image */
    imageTokens: number,
    /** Max prompt audio clips */
    maxAudio: number,
    /** Max characters kept per message */
    maxContentLength: number,
    /** Max prompt characters */
    promptCharBudget: number,
    /** Max CPU threads */
    maxThreads: number,
    /** GPU busy share */
    gpuShare: number,
}

/** Reported model and request state */
interface ChatStatusSnapshot {
    /** Device-specific model build */
    model?: ChatModelId,
    /** Derived engine availability */
    availability: ChatStatus,
    status: LlmStatus,
    backend: LlmBackend,
    /** Model image support */
    supportsImages: boolean,
    /** Model audio support */
    supportsAudio: boolean,
    ready: boolean,
    loading: boolean,
    /** Reply streaming flag */
    requesting: boolean,
    phase: LlmPhase,
    /** Download or load progress, 0..100 */
    percent: number,
    /** Last request error */
    error?: string,
}

/** Chat request callback */
interface ChatInput {
    /** Model that answers */
    model?: ChatModelId,
    /** Complete chat prompt */
    messages: ChatMessage[],
    /** Budget overrides */
    limits?: Partial<LlmLimits>,
    /** Reasoning option, off */
    reasoning?: boolean,
    /** Logging option, off */
    logging?: boolean,
    /** Streamed reasoning text */
    onThinking?: (text: string) => void,
    /** Streamed reply text */
    onResponse: (text: string) => void,
    /** Generation speed callback */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Prompt processing speed callback */
    onPromptSpeed?: (tokensPerSecond: number) => void,
    /** Status change callback */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
}

/** Model preload request */
type ChatPreloadInput = Pick<ChatInput, ChatPreloadField>;

/** Stop request or model */
type CancelChat = () => void;

/** Seconds estimated per operation */
interface EstimateEntry {
    operation: EstimateOperation,
    /** Seconds */
    est: number,
}

/** Estimate handed to the caller */
interface EstimateReport {
    /** Sum of breakdown, seconds */
    totalEst: number,
    /** Per-operation seconds, call order */
    breakdown: EstimateEntry[],
}

/** Options shared by every call */
interface CallOptions {
    /** Stop request */
    signal?: AbortSignal,
    /** Budget overrides */
    limits?: Partial<LlmLimits>,
    /** Logging option, off */
    logging?: boolean,
    /** Status change callback */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
    /** Duration estimate callback */
    onEstimate?: (estimate: EstimateReport) => void,
}

/** One image description request */
interface DescribeImageInput extends CallOptions {
    /** One image URL */
    image: string,
    /** Additional rules */
    systemRulesOverride?: string,
    /** Generation speed callback */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Streamed text callback */
    onText?: (text: string) => void,
}

/** English text enhancement request */
interface DescriptionEnhancedInput extends CallOptions {
    /** English description */
    descriptionEN: string,
    /** Target language name */
    targetLanguage: string,
    /** Target language code */
    targetCode: string,
    /** Whether tags are generated */
    withTags?: boolean,
    /** Whether description is translated */
    withDescription?: boolean,
    /** Text model override */
    model?: ChatModelId,
    /** Running stage callback */
    onStage?: (stage: DescriptionEnhancedStage) => void,
    /** Generation speed callback */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Streamed text callback */
    onText?: (text: string, stage: DescriptionEnhancedStage) => void,
}

/** Gallery tag with translations */
interface ImageTag {
    /** English tag */
    en: string,
    /** Translation keyed by language code */
    [code: string]: string,
}

/** Stored tags translation request */
interface TranslateTagsInput extends CallOptions {
    /** Tags to translate */
    tags: ImageTag[],
    /** Target language name */
    targetLanguage: string,
    /** Target language code */
    targetCode: string,
    /** Text model override */
    model?: ChatModelId,
    /** Streamed text callback */
    onText?: (text: string) => void,
}

/** Enhanced English description */
interface DescriptionEnhanced {
    /** Translated description, English fallback */
    description: string,
    /** Whether translation succeeded */
    translated: boolean,
    /** English and translated tags */
    tags: ImageTag[],
    /** Suggestive content flag, undefined unknown */
    nsfw?: boolean,
}

/** @deprecated to be removed after Nov 2027 */
interface ImageDescription {
    /** Vision description */
    descriptionEN: string,
    /** Description translation */
    description: string,
    /** Description duration */
    durationMs: number,
}

/** @deprecated to be removed after Nov 2027 */
interface DescribeImagesInput {
    /** Target description language */
    targetLanguage: string,
    /** Ordered image URLs */
    images: string[],
    /** Stop batch, keep finished */
    signal?: AbortSignal,
    /** Description progress callback */
    currentIndex?: (
        index: number,
        descriptionEN?: string,
        description?: string,
        durationMs?: number,
    ) => void,
    /** Image speed callback */
    onSpeed?: (index: number, tokensPerSecond: number) => void,
    /** Image text callback */
    onText?: (
        index: number,
        text: string,
        stage: `describe` | `translate`,
    ) => void,
    /** Budget overrides */
    limits?: Partial<LlmLimits>,
    /** Logging option, off */
    logging?: boolean,
    /** Status change callback */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
    /** Additional rules */
    additionalRules?: string,
}

/** @deprecated to be removed after Nov 2027 */
interface DescribeTranslatedInput {
    /** Ordered English descriptions */
    descriptions: string[],
    /** Target translation language */
    targetLanguage: string,
    /** Stop batch, keep finished */
    signal?: AbortSignal,
    /** Translation progress callback */
    currentIndex?: (
        index: number,
        descriptionEN?: string,
        description?: string,
    ) => void,
    /** Translation speed callback */
    onSpeed?: (index: number, tokensPerSecond: number) => void,
    /** Translation text callback */
    onText?: (
        index: number,
        text: string,
        stage: `translate`,
    ) => void,
    /** Budget overrides */
    limits?: Partial<LlmLimits>,
    /** Logging option, off */
    logging?: boolean,
    /** Status change callback */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
}

/** CPU wasm assets */
interface WllamaAssets {
    /** wllama wasm URL */
    wasm: string,
    /** Compat wasm URL */
    compatWasm: string,
    /** Compat worker URL */
    compatWorker: string,
}

/** GPU wasm assets */
interface LitertAssets {
    /** LiteRT glue URL */
    script: string,
    /** LiteRT wasm URL */
    wasm: string,
}

/** WebGPU navigator type */
interface GpuNavigator extends Navigator {
    gpu?: {
        /** Request WebGPU adapter */
        requestAdapter: (options?: {
            powerPreference?: `low-power` | `high-performance`,
        }) => Promise<unknown>,
    },
}

/** Minimal WebGPU buffer */
interface GpuBuffer {
    /** Map buffer after work */
    mapAsync: (...args: unknown[]) => Promise<void>,
}

/** Minimal WebGPU device */
interface GpuDevice {
    /** Create engine buffer */
    createBuffer?: (...args: unknown[]) => GpuBuffer,
    /** Release device resources */
    destroy?: () => void,
}

/** Reset wasm fields */
interface GpuWasm {
    preinitializedWebGPUDevice?: GpuDevice,
    WebGPU?: { preinitializedDeviceId?: number },
}

/** GPU throttle state */
interface GpuThrottleParams {
    device: GpuDevice,
    /** Rest after one GPU readback */
    pace: () => Promise<void>,
}

/** Mobile detection fields */
type MobileNavigator = Pick<Navigator, `userAgent` | `maxTouchPoints`> & {
    /** Chromium mobile hint */
    userAgentData?: { mobile?: boolean },
};

/** Status snapshot state */
interface ChatState {
    /** Reply streaming flag */
    requesting: boolean,
    phase: LlmPhase,
    /** Download or load progress, 0..100 */
    percent: number,
    /** Last request error */
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

/** Test engine overrides */
interface RuntimeDeps {
    engines?: { cpu?: LlmEngine, litert?: LlmEngine },
    backend?: LlmBackend,
    /** Device class override, tests only */
    mobile?: () => boolean,
}

/** One model load request */
interface RuntimeLoadParams {
    model: ChatModel,
    limits: LlmLimits,
    assets?: Partial<WllamaAssets>,
    /** Engine logging flag */
    logging?: boolean,
    /** Stop awaiting shared load */
    signal?: AbortSignal,
    onProgress: (progress: number, phase: LlmPhase) => void,
}

/** Waiting load caller */
interface RuntimeLoadWaiter {
    /** Report caller progress */
    report: RuntimeLoadParams[`onProgress`],
    /** Resolve waiting caller */
    settle: (loaded: boolean) => void,
}

/** Stored model file bytes */
interface StoredPart {
    /** Bytes already stored */
    size: number,
    /** File size, zero unknown */
    total: number,
    /** Stored bytes entity tag */
    etag: string,
}

/** Model part file */
interface StoredFilePart {
    /** Part byte offset */
    start: number,
    /** Bytes stored in the part */
    size: number,
}

/** Stored model file */
interface StoredModel extends StoredPart {
    /** Stored file snapshot */
    file: Blob,
    /** Complete file flag */
    complete: boolean,
}

/** Stored download metadata */
interface StoredModelMeta {
    total: number,
    etag: string,
    complete: boolean,
}

/** Stored part continuation */
interface ResumePlan {
    /** Response start byte */
    start: number,
    /** File size, zero unknown */
    total: number,
    etag: string,
}

/** Model download into store */
interface StoreDownloadParams {
    /** Stable cache key */
    url: string,
    /** Pinned fetch URL */
    sourceUrl?: string,
    /** Stop download, keep bytes */
    signal?: AbortSignal,
    onProgress: StartLlmParams[`onProgress`],
}

/** Engine resumable file store */
interface ModelStore {
    /** Stored model file info */
    stored: (url: string) => Promise<StoredModel | undefined>,
    /** Resume model file download */
    download: (params: StoreDownloadParams) => Promise<StoredModel | undefined>,
    /** Delete model file */
    remove: (url: string) => Promise<void>,
    /** Delete entire store */
    purge: () => Promise<void>,
}

/** One generation request */
interface RuntimeChatParams {
    /** Resolved answer model */
    model?: ChatModelId,
    messages: ChatMessage[],
    limits: LlmLimits,
    reasoning: boolean,
    /** Repetition penalty */
    repeatPenalty?: number,
    /** Sampling temperature */
    temperature?: number,
    /** Engine logging flag */
    logging?: boolean,
    onReason: (text: string) => void,
    onText: (text: string) => void,
    /** Generation speed */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Prompt processing speed */
    onPromptSpeed?: (tokensPerSecond: number) => void,
    signal?: AbortSignal,
}

/** Shared on-device runtime */
interface Runtime {
    /** Load or join model */
    load: (params: RuntimeLoadParams) => Promise<boolean>,
    chat: (params: RuntimeChatParams) => Promise<string | undefined>,
    /** Release one or all models */
    unload: (model?: ChatModelId) => Promise<void>,
    /** Release and delete caches */
    clear: () => Promise<void>,
    /** Model loaded check */
    ready: (model?: ChatModelId) => boolean,
    /** Model loading check */
    loading: (model?: ChatModelId) => boolean,
    /** Model load status */
    status: (model?: ChatModelId) => LlmStatus,
    /** Model backend */
    backend: (model?: ChatModelId) => LlmBackend,
    /** Latest model load error */
    error: (model?: ChatModelId) => string | undefined,
    /** Last active model */
    model: () => ChatModel | undefined,
}

/** Single chat generation params */
interface EngineChatParams {
    messages: ChatMessage[],
    limits: LlmLimits,
    /** Opt-in reasoning preference */
    reasoning: boolean,
    /** Repetition penalty */
    repeatPenalty?: number,
    /** Sampling temperature */
    temperature?: number,
    /** Engine logging flag */
    logging?: boolean,
    /** Streamed reasoning delta */
    onReason: (text: string) => void,
    /** Streamed reply delta */
    onText: (text: string) => void,
    /** Generation speed */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Prompt processing speed */
    onPromptSpeed?: (tokensPerSecond: number) => void,
    signal?: AbortSignal,
}

/** Params of the engine startLLM */
interface StartLlmParams {
    model: ChatModel,
    /** Engine load budgets */
    limits: LlmLimits,
    /** Download progress callback */
    onProgress: (progress: number, phase?: LlmPhase) => void,
    /** Cancel download or load */
    signal?: AbortSignal,
    /** Engine logging flag */
    logging?: boolean,
    /** CPU engine asset override */
    assets?: Partial<WllamaAssets>,
}

/** Engine start result */
interface LlmRuntime {
    /** Model this runtime serves */
    model: ChatModel,
    /** Backend that accepted the model */
    backend: LlmBackend,
    /** Requested context window */
    contextSize: number,
    /** Stream reply text */
    chat: (params: EngineChatParams) => Promise<string | undefined>,
    /** Release model, keep cache */
    unload: () => Promise<void>,
}

/** Engine-backed model runner */
interface LlmEngine {
    backend: LlmBackend,
    /** Load model runtime */
    startLLM: (params: StartLlmParams) => Promise<LlmRuntime>,
    /** Model files stored check */
    cached: (model: ChatModel) => Promise<boolean>,
    /** Delete engine artifacts */
    purge: () => Promise<void>,
}

/** User turn content part */
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

/** OpenAI-style chat message */
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

/** LiteRT engine settings */
type LitertSettings = import('@litert-lm/core').EngineSettings;

/** LiteRT settings params */
interface LitertSettingsParams {
    /** Model with the artifact */
    model: ChatModel,
    /** Image budgets */
    limits: LlmLimits,
    /** Requested context window */
    contextSize: number,
    /** Model file stream */
    source: ReadableStream<Uint8Array>,
    /** Loaded LiteRT module */
    mod: LitertModule,
}

/** Reused LiteRT conversation */
interface LitertSession {
    /** Live LiteRT conversation */
    conversation?: import('@litert-lm/core').Conversation,
    /** Sent conversation turns */
    sent: EngineMessage[],
    /** Conversation reasoning flag */
    reasoning: boolean,
    /** Conversation output budget */
    maxTokens: number,
}

/** LiteRT chat params */
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
    /** Fitted output budget */
    maxTokens: number,
    session: LitertSession,
}

/** Streamed reasoning delta */
interface EngineDelta {
    content?: string,
    reasoning?: string,
    reasoning_content?: string,
}

/** Engine stream timings */
interface EngineTimings {
    /** Prompt tokens per second */
    prompt_per_second?: number,
    /** Prompt tokens evaluated */
    prompt_n?: number,
}

/** Engine prefill progress */
interface EnginePromptProgress {
    /** Prompt tokens total */
    total?: number,
    /** Processed prompt tokens */
    processed?: number,
    /** Prefill time, milliseconds */
    time_ms?: number,
    /** wllama total token field */
    n_prompt_tokens?: number,
    /** wllama processed token field */
    n_prompt_tokens_processed?: number,
}

/** Engine stream chunk */
interface EngineChunk {
    choices?: Array<{ finish_reason?: string, delta?: EngineDelta }>,
    timings?: EngineTimings,
    prompt_progress?: EnginePromptProgress,
}

/** Params of one streamed reply */
interface StreamReplyParams {
    model: ChatModel,
    /** Streamed reasoning delta */
    onReason: (text: string) => void,
    /** Streamed reply delta */
    onText: (text: string) => void,
    /** Generation speed */
    onSpeed?: (tokensPerSecond: number) => void,
    /** Prompt processing speed */
    onPromptSpeed?: (tokensPerSecond: number) => void,
    /** Estimated prompt tokens */
    promptTokens?: number,
    /** Open engine stream */
    start: () => Promise<AsyncIterable<unknown>>,
    /** Generation stopped flag */
    stopped: () => boolean,
    /** Engine logging flag */
    logging?: boolean,
    /** First chunk timeout */
    firstTimeoutMs?: number,
    /** Budget between two chunks, milliseconds */
    idleTimeoutMs?: number,
    /** Slow stream callback */
    onStall?: () => void,
}

/** Engine chat params */
interface EngineRunParams {
    model: ChatModel,
    params: EngineChatParams,
    /** Open engine stream */
    start: (messages: EngineMessage[], maxTokens: number) =>
        Promise<AsyncIterable<unknown>>,
    /** Generation stopped flag */
    stopped: () => boolean,
    /** Slow stream callback */
    onStall?: () => void,
}

/** Engine image pixel size */
interface ImageSize {
    width: number,
    height: number,
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
    CallOptions,
    EstimateEntry,
    EstimateReport,
    DescribeImageInput,
    DescriptionEnhancedInput,
    DescriptionEnhancedStage,
    DescriptionEnhanced,
    ImageTag,
    TranslateTagsInput,
    ImageDescription,
    DescribeImagesInput,
    DescribeTranslatedInput,
    WllamaAssets,
    LitertAssets,
    GpuBuffer,
    GpuDevice,
    GpuWasm,
    GpuThrottleParams,
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
    ImageSize,
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
    EngineTimings,
    EnginePromptProgress,
    EngineChunk,
    StreamReplyParams,
    EngineRunParams,
};
