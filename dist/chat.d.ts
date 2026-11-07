import { ChatModelId } from './enums';
import type { CancelChat, ChatInput, ChatPreloadInput, ChatState, ChatStatusSnapshot, Runtime } from './types';
declare const 
/** Build one status snapshot */
statusSnapshot: (service: Runtime, model: ChatModelId | undefined, state: ChatState) => ChatStatusSnapshot, 
/** Build chat over one runtime */
createChatOn: (service: Runtime) => ((input: ChatInput) => CancelChat), 
/** Build preload over one runtime */
createPreloadOn: (service: Runtime) => (input?: ChatPreloadInput) => Promise<boolean>, createChat: (input: ChatInput) => CancelChat, preloadModel: (input?: ChatPreloadInput) => Promise<boolean>, 
/** Delete every cached model file */
clearModelCache: () => Promise<void>;
export { clearModelCache, createChat, createChatOn, createPreloadOn, preloadModel, statusSnapshot, };
