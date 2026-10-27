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
    hasCache?: boolean;
    loadGate?: Promise<void>;
    chatGate?: Promise<void>;
    chatText?: string;
    thinkingText?: string;
    failStart?: boolean;
    failChat?: boolean;
    onStart?: (model: ChatModel) => void;
    onChat?: (params: EngineChatParams) => void;
    /** Replace the scripted reply with a real engine run */
    chatImpl?: (params: EngineChatParams) => Promise<string | undefined>;
}

/** One fake engine and its call log. */
export interface FakeEngine {
    engine: LlmEngine;
    calls: {
        start: number;
        chat: number;
        unload: number;
        remove: number;
        purge: number;
        cached: number;
    };
    models: ChatModel[];
    limits: LlmLimits[];
    requests: EngineChatParams[];
    loggings: Array<boolean | undefined>;
}

export const createFakeEngine: (options?: FakeEngineOptions) => FakeEngine;
