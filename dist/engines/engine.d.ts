import type { ChatMessage, ChatModel, EngineMessage, EngineRunParams, LlmLimits, StreamReplyParams } from '../types';
declare const 
/** Default engine budgets */
defaultLlmLimits: LlmLimits, 
/** Merge budgets over backend defaults */
resolveLlmLimits: (overrides?: Partial<LlmLimits>, gpu?: boolean) => LlmLimits, 
/** Sampling options for every stream */
replyOptions: (limits: LlmLimits, reasoning: boolean, temperature?: number) => {
    stream: true;
    temperature: number;
    max_tokens: number;
}, 
/** Resolve one model file URL */
modelUrl: (repo: string, file: string) => string, 
/** Declared download size or zero */
contentLength: (response: Response) => number, 
/** Any turn carries an image */
hasImages: (messages: EngineMessage[]) => boolean, 
/** Whether any turn carries audio */
hasAudio: (messages: EngineMessage[]) => boolean, 
/** Map host messages to turns */
buildMessages: (messages: ChatMessage[], limits?: LlmLimits) => EngineMessage[], 
/** Split reasoning markers from content */
createThinkSplitter: (onReason: (text: string) => void, onText: (text: string) => void) => {
    feed: (text: string) => void;
    flush: () => void;
};
declare const 
/** Log chat call, text censored */
logChatCall: (model: ChatModel, messages: EngineMessage[]) => void, 
/** Stream reply, undefined when stopped */
streamReply: ({ model, logging, onReason, onText, onSpeed, onPromptSpeed, promptTokens, start, stopped, firstTimeoutMs, idleTimeoutMs, onStall, }: StreamReplyParams) => Promise<string | undefined>, 
/** Build prompt, stream through engine */
runEngineChat: ({ model, params, start, stopped, onStall, }: EngineRunParams) => Promise<string | undefined>;
export { buildMessages, createThinkSplitter, logChatCall, runEngineChat, streamReply, replyOptions, defaultLlmLimits, resolveLlmLimits, hasImages, hasAudio, modelUrl, contentLength, };
