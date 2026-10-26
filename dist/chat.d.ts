import type { CancelChat, ChatInput, ChatPreloadInput, Runtime } from './types';
/** Build a one-shot chat function over one runtime */
declare const createChatOn: (service: Runtime) => ((input: ChatInput) => CancelChat);
/** Build a model preload over one runtime */
declare const createPreloadOn: (service: Runtime) => (input?: ChatPreloadInput) => Promise<boolean>;
declare const createChat: (input: ChatInput) => CancelChat;
declare const preloadModel: (input?: ChatPreloadInput) => Promise<boolean>;
export { createChat, createChatOn, createPreloadOn, preloadModel };
