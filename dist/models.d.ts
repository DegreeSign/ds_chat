import { ChatModelId } from './enums';
import type { ChatModel, MobileNavigator } from './types';
declare const llmModels: ChatModel[], 
/** CPU context window, 8k tokens */
cpuContextWindow = 8192, // max 262_400
/** Phone CPU window, 4096 tokens */
mobileCpuContextWindow = 4096, // max 32_768
/** GPU context window, 32k tokens */
litertContextWindow = 32768, // max 32_768
/** Phone GPU window, 16k tokens */
mobileLitertContextWindow = 16384, // max 32_768
/** Whether this client is mobile */
mobileDevice: (nav?: MobileNavigator) => boolean, 
/** Gemma build this device loads */
deviceModelId: (id?: ChatModelId, mobile?: boolean) => ChatModelId | undefined, 
/** Find catalog entry by id */
findLlmModel: (id?: string) => ChatModel | undefined, 
/** Whether browser has WebGPU adapter */
gpuAdapter: () => Promise<boolean>, 
/** Default model, GPU when available */
defaultLlmModel: () => Promise<ChatModelId | undefined>, 
/** Resolve requested model or default */
resolveLlmModel: (id?: ChatModelId) => Promise<ChatModel | undefined>, 
/** Whether a model accepts images */
supportsImages: (model: ChatModel) => boolean, 
/** Whether a model accepts audio */
supportsAudio: (model: ChatModel) => boolean;
export { llmModels, cpuContextWindow, mobileCpuContextWindow, litertContextWindow, mobileLitertContextWindow, mobileDevice, deviceModelId, findLlmModel, gpuAdapter, defaultLlmModel, resolveLlmModel, supportsImages, supportsAudio, };
