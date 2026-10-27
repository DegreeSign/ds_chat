import { ChatModelId } from './enums';
import type { CancelChat, ChatInput, ChatPreloadInput, ChatState, ChatStatusSnapshot, Runtime } from './types';
/** Build one model and request status snapshot */
declare const statusSnapshot: (service: Runtime, model: ChatModelId | undefined, state: ChatState) => ChatStatusSnapshot;
/** Build a one-shot chat function over one runtime */
declare const createChatOn: (service: Runtime) => ((input: ChatInput) => CancelChat);
/** Build a model preload over one runtime */
declare const createPreloadOn: (service: Runtime) => (input?: ChatPreloadInput) => Promise<boolean>;
declare const createChat: (input: ChatInput) => CancelChat;
declare const preloadModel: (input?: ChatPreloadInput) => Promise<boolean>;
/** Delete every model file cached on this device */
declare const clearModelCache: () => Promise<void>;
export { clearModelCache, createChat, createChatOn, createPreloadOn, preloadModel, statusSnapshot, };
