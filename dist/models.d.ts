import { ChatModelId } from './enums';
import type { ChatModel, MobileNavigator } from './types';
declare const llmModels: ChatModel[], 
/** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
cpuContextWindow = 8192, 
/** CPU window on a phone, the smaller cache keeps the tab alive */
mobileCpuContextWindow = 4096, 
/** Context window requested from the GPU engine, the wasm heap holds the model */
litertContextWindow = 4096, 
/** Whether this client is a phone or tablet */
mobileDevice: (nav?: MobileNavigator) => boolean, 
/** Build of a Gemma request that this device loads */
deviceModelId: (id?: ChatModelId, mobile?: boolean) => ChatModelId | undefined, 
/** Look up a catalog entry by id */
findLlmModel: (id?: string) => ChatModel | undefined, 
/** Whether this browser provides a WebGPU adapter */
gpuAdapter: () => Promise<boolean>, 
/** Default model, the GPU one when a WebGPU adapter exists */
defaultLlmModel: () => Promise<ChatModelId | undefined>, 
/** Resolve the requested model or the default of this device */
resolveLlmModel: (id?: ChatModelId) => Promise<ChatModel | undefined>, 
/** Whether a model accepts images */
supportsImages: (model: ChatModel) => boolean, 
/** Whether a model accepts audio */
supportsAudio: (model: ChatModel) => boolean;
export { llmModels, cpuContextWindow, mobileCpuContextWindow, litertContextWindow, mobileDevice, deviceModelId, findLlmModel, gpuAdapter, defaultLlmModel, resolveLlmModel, supportsImages, supportsAudio, };
