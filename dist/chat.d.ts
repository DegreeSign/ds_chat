import { ChatModelId } from './enums';
import type { CancelChat, ChatInput, ChatPreloadInput, ChatState, ChatStatusSnapshot, Runtime } from './types';
/** Build one status snapshot */
declare const statusSnapshot: (service: Runtime, model: ChatModelId | undefined, state: ChatState) => ChatStatusSnapshot;
/** Build chat over one runtime */
declare const createChatOn: (service: Runtime) => ((input: ChatInput) => CancelChat);
/** Build preload over one runtime */
declare const createPreloadOn: (service: Runtime) => (input?: ChatPreloadInput) => Promise<boolean>;
declare const createChat: (input: ChatInput) => CancelChat;
declare const preloadModel: (input?: ChatPreloadInput) => Promise<boolean>;
/** Delete every cached model file */
declare const clearModelCache: () => Promise<void>;
export { clearModelCache, createChat, createChatOn, createPreloadOn, preloadModel, statusSnapshot, };
