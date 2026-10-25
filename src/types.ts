import type {
    ChatModelId,
    ChatStatus,
    LlmBackend,
    LlmPhase,
    LlmRole,
    LlmStatus,
} from './enums';

/** One chat message, owned by the host */
interface ChatMessage {
    role: LlmRole,
    content: string,
    /** Image data URLs or URLs attached to the turn */
    images?: string[],
}

/** One on-device model */
interface ChatModel {
    /** Stable catalog id, passed by the host */
    id: ChatModelId,
    /** Whether the model supports chain-of-thought reasoning */
    reasoning: boolean,
    /** wllama (CPU) artifact */
    cpu: {
        repo: string,
        file: string,
        /** Vision projector, present when the CPU build accepts images */
        mmproj?: {
            file: string,
        },
    },
}

/** Token, prompt and thread budgets of an on-device generation */
interface LlmLimits {
    /** Max answer tokens */
    maxReplyTokens: number,
    /** Max chain-of-thought tokens, used by the CPU engine when it loads */
    maxThinkingTokens: number,
    /** Total output budget when reasoning is on, thinking plus answer */
    maxReasoningTokens: number,
    /** Max images sent in one prompt */
    maxImages: number,
    /** Max characters kept per message */
    maxContentLength: number,
    /** Max characters of the whole prompt */
    promptCharBudget: number,
    /** Max CPU threads, applied after the hardware maximum */
    maxThreads: number,
}

/** Current model and request state reported to the host */
interface ChatStatusSnapshot {
    /** Availability derived from the engine status */
    availability: ChatStatus,
    status: LlmStatus,
    backend: LlmBackend,
    /** Whether the requested model accepts images on this backend */
    supportsImages: boolean,
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
    /** On-device model that answers this request */
    model: ChatModelId,
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
    /** Model and request state, reported on every change */
    onStatus?: (snapshot: ChatStatusSnapshot) => void,
}

/** Stop the current request, its model load, or free the loaded model */
type CancelChat = () => void;

/** wllama wasm assets used by the CPU engine */
interface WllamaAssets {
    /** URL of the wllama wasm binary */
    wasm: string,
    /** URL of the wllama compat wasm binary */
    compatWasm: string,
    /** URL of the wllama compat worker script */
    compatWorker: string,
}

/** One live chat request */
interface ActiveCall {
    token: number,
    input: ChatInput,
    controller: AbortController,
    percent: number,
    phase: LlmPhase,
    requesting: boolean,
    cancelled: boolean,
    error?: string,
}

/** Engine and backend overrides used by tests */
interface RuntimeDeps {
    engines?: { cpu?: LlmEngine },
    backend?: LlmBackend,
}

/** One model load request */
interface RuntimeLoadParams {
    model: ChatModel,
    limits: LlmLimits,
    assets?: Partial<WllamaAssets>,
    /** Whether engine logs reach the console */
    logging?: boolean,
    onProgress: (progress: number, phase: LlmPhase) => void,
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
    signal?: AbortSignal,
}

/** On-device runtime shared by every request */
interface Runtime {
    load: (params: RuntimeLoadParams) => Promise<boolean>,
    chat: (params: RuntimeChatParams) => Promise<string | undefined>,
    unload: () => Promise<void>,
    cancelLoad: () => void,
    ready: () => boolean,
    loading: () => boolean,
    status: () => LlmStatus,
    backend: () => LlmBackend,
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
    /** Whether this engine holds any cache, checked before loading the engine */
    hasCache: () => Promise<boolean>,
    /** Delete the model's on-device cache */
    remove: (model: ChatModel) => Promise<void>,
    /** Delete every on-device artifact this engine keeps, including orphans */
    purge: () => Promise<void>,
}

/** One text or image segment of a user turn */
type EngineContentPart =
    | { type: `text`, text: string }
    | { type: `image`, url: string };

/** One wllama content segment */
type WllamaContentPart =
    | { type: `text`, text: string }
    | { type: `image`, data: ArrayBuffer };

/** One wllama chat turn */
type WllamaMessage =
    | { role: `system`, content: string }
    | { role: `user`, content: string | WllamaContentPart[] }
    | { role: `assistant`, content: string };

/** One OpenAI-style message */
type EngineMessage =
    | { role: `system`, content: string }
    | { role: `user`, content: string | EngineContentPart[] }
    | { role: `assistant`, content: string };

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
    /** Open the engine stream for the prepared messages */
    start: () => Promise<AsyncIterable<unknown>>,
    /** Whether the caller stopped the generation */
    stopped: () => boolean,
    /** Whether engine logs reach the console */
    logging?: boolean,
}

/** Params of one engine chat call */
interface EngineRunParams {
    model: ChatModel,
    params: EngineChatParams,
    /** Open the engine stream for the prepared messages */
    start: (messages: EngineMessage[]) => Promise<AsyncIterable<unknown>>,
    /** Whether the caller stopped the generation */
    stopped: () => boolean,
}

export type {
    ChatMessage,
    ChatModel,
    LlmLimits,
    ChatStatusSnapshot,
    ChatInput,
    CancelChat,
    WllamaAssets,
    ActiveCall,
    RuntimeDeps,
    RuntimeLoadParams,
    RuntimeChatParams,
    Runtime,
    EngineChatParams,
    StartLlmParams,
    LlmRuntime,
    LlmEngine,
    EngineMessage,
    EngineContentPart,
    WllamaContentPart,
    WllamaMessage,
    EngineDelta,
    EngineChunk,
    StreamReplyParams,
    EngineRunParams,
};
