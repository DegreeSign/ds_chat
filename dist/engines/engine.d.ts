import type { ChatMessage, ChatModel, EngineMessage, EngineRunParams, LlmLimits, StreamReplyParams } from '../types';
/** Default token, prompt and thread budgets of the CPU engine */
declare const defaultLlmLimits: LlmLimits;
/** Merge developer budgets over the backend defaults */
declare const resolveLlmLimits: (overrides?: Partial<LlmLimits>, gpu?: boolean) => LlmLimits;
/** Sampling options shared by every engine stream */
declare const replyOptions: (limits: LlmLimits, reasoning: boolean) => {
    stream: true;
    temperature: number;
    max_tokens: number;
};
declare const 
/** Resolve one model file on the model host */
modelUrl: (repo: string, file: string) => string, 
/** Declared size of one download, zero when the host hides it */
contentLength: (response: Response) => number, 
/** Whether any turn carries an image */
hasImages: (messages: EngineMessage[]) => boolean;
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
streamReply: ({ model, logging, onReason, onText, start, stopped, firstTimeoutMs, idleTimeoutMs, onStall, }: StreamReplyParams) => Promise<string | undefined>;
declare const 
/** Build the prompt and stream one reply through an engine */
runEngineChat: ({ model, params, start, stopped, onStall, }: EngineRunParams) => Promise<string | undefined>;
export { buildMessages, createThinkSplitter, logChatCall, runEngineChat, streamReply, replyOptions, defaultLlmLimits, resolveLlmLimits, hasImages, modelUrl, contentLength, };
