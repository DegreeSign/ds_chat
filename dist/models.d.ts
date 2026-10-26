import { ChatModelId } from './enums';
import type { ChatModel, LitertArtifact, MobileNavigator } from './types';
declare const llmModels: ChatModel[], 
/** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
cpuContextWindow = 8192, 
/** CPU window on a phone, the smaller cache keeps the tab alive */
mobileCpuContextWindow = 4096, 
/** Context window requested from the GPU engine, the wasm heap holds the model */
litertContextWindow = 4096, 
/** Whether this client is a phone or tablet */
mobileDevice: (nav?: MobileNavigator) => boolean, 
/** LiteRT file and capabilities of this device */
litertArtifact: (model: ChatModel, mobile?: boolean) => LitertArtifact | undefined, 
/** Look up a catalog entry by id */
findLlmModel: (id?: string) => ChatModel | undefined, 
/** Whether this browser provides a WebGPU adapter */
gpuAdapter: () => Promise<boolean>, 
/** Default model, the GPU one when a WebGPU adapter exists */
defaultLlmModel: () => Promise<ChatModelId | undefined>, 
/** Resolve the requested model or the default of this device */
resolveLlmModel: (id?: ChatModelId) => Promise<ChatModel | undefined>, 
/** Whether a model accepts images */
supportsImages: (model: ChatModel, mobile?: boolean) => boolean, 
/** Whether a model accepts audio */
supportsAudio: (model: ChatModel, mobile?: boolean) => boolean, 
/** Whether a model accepts tool declarations */
supportsTools: (model: ChatModel, mobile?: boolean) => boolean;
export { llmModels, cpuContextWindow, mobileCpuContextWindow, litertContextWindow, mobileDevice, litertArtifact, findLlmModel, gpuAdapter, defaultLlmModel, resolveLlmModel, supportsImages, supportsAudio, supportsTools, };
