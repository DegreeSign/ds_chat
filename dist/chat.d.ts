import type { CancelChat, ChatInput, Runtime } from './types';
/** Build a one-shot chat function over one runtime */
declare const createChatOn: (service: Runtime) => ((input: ChatInput) => CancelChat);
declare const createChat: (input: ChatInput) => CancelChat;
export { createChat, createChatOn };
