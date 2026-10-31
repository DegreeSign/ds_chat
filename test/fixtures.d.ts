import type { LlmBackend } from '../src/enums';
import type {
    ChatModel,
    EngineChatParams,
    LlmEngine,
    LlmLimits,
} from '../src/types';

/** Options for one fake engine. */
export interface FakeEngineOptions {
    backend?: LlmBackend;
    cached?: boolean;
    loadGate?: Promise<void>;
    chatGate?: Promise<void>;
    chatText?: string;
    thinkingText?: string;
    failStart?: boolean;
    failChat?: boolean;
    onStart?: (model: ChatModel) => void;
    onChat?: (params: EngineChatParams) => void;
    /** Use a real engine reply */
    chatImpl?: (params: EngineChatParams) => Promise<string | undefined>;
}

/** Fake engine with call log */
export interface FakeEngine {
    engine: LlmEngine;
    calls: {
        start: number;
        chat: number;
        unload: number;
        purge: number;
        cached: number;
    };
    models: ChatModel[];
    limits: LlmLimits[];
    requests: EngineChatParams[];
    loggings: Array<boolean | undefined>;
}

export const createFakeEngine: (options?: FakeEngineOptions) => FakeEngine;
