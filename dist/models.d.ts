import type { ChatModel } from './types';
declare const llmModels: ChatModel[], 
/** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
cpuContextWindow = 8192, 
/** Look up a catalog entry by id */
findLlmModel: (id?: string) => ChatModel | undefined, 
/** Whether a model accepts images */
supportsImages: (model: ChatModel) => boolean;
export { llmModels, cpuContextWindow, findLlmModel, supportsImages, };
