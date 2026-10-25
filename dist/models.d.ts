import type { ChatModel } from './types';
declare const llmModels: ChatModel[], 
/** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
cpuContextWindow = 8192, 
/** Context window requested from the GPU engine, the wasm heap holds the model */
litertContextWindow = 4096, 
/** Look up a catalog entry by id */
findLlmModel: (id?: string) => ChatModel | undefined, 
/** Whether a model accepts images */
supportsImages: (model: ChatModel) => boolean;
export { llmModels, cpuContextWindow, litertContextWindow, findLlmModel, supportsImages, };
