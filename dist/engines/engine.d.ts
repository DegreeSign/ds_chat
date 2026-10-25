import type { ChatMessage, ChatModel, EngineMessage, EngineRunParams, LlmLimits, StreamReplyParams } from '../types';
/** Default token, prompt and thread budgets */
declare const defaultLlmLimits: LlmLimits;
/** Merge developer budgets over the defaults */
declare const resolveLlmLimits: (overrides?: Partial<LlmLimits>) => LlmLimits;
/** Sampling options shared by every engine stream */
declare const replyOptions: (limits: LlmLimits, reasoning: boolean) => {
    stream: true;
    temperature: number;
    max_tokens: number;
};
declare const 
/** Map the host messages to OpenAI-style turns, bounded for local context */
buildMessages: (messages: ChatMessage[], limits?: LlmLimits) => EngineMessage[], 
/** Split inline reasoning markers out of the streamed content */
createThinkSplitter: (onReason: (text: string) => void, onText: (text: string) => void) => {
    feed: (text: string) => void;
    flush: () => void;
};
declare const 
/** Log an engine chat call with all message text censored */
logChatCall: (model: ChatModel, messages: EngineMessage[]) => void, 
/** Stream one reply, logging it and returning undefined when stopped */
streamReply: ({ model, logging, onReason, onText, start, stopped, }: StreamReplyParams) => Promise<string | undefined>;
declare const 
/** Build the prompt and stream one reply through an engine */
runEngineChat: ({ model, params, start, stopped, }: EngineRunParams) => Promise<string | undefined>;
export { buildMessages, createThinkSplitter, logChatCall, runEngineChat, streamReply, replyOptions, defaultLlmLimits, resolveLlmLimits, };
