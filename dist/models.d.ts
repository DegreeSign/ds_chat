import { ChatModelId } from './enums';
import type { ChatModel } from './types';
declare const llmModels: ChatModel[], 
/** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
cpuContextWindow = 8192, 
/** Context window requested from the GPU engine, the wasm heap holds the model */
litertContextWindow = 4096, 
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
export { llmModels, cpuContextWindow, litertContextWindow, findLlmModel, gpuAdapter, defaultLlmModel, resolveLlmModel, supportsImages, supportsAudio, };
