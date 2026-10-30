import type { ChatModel, EngineMessage, LlmEngine, LlmRuntime, StartLlmParams, WllamaMessage } from '../types';
/** Image limits of one model */
declare const visionLimits: (model: ChatModel) => {
    image_min_tokens: number;
    image_max_tokens: number;
} | {
    image_min_tokens?: undefined;
    image_max_tokens?: undefined;
};
declare const 
/** Every CPU file of one model, its name and remote URL */
cpuFiles: (model: ChatModel) => Array<{
    name: string;
    url: string;
}>, 
/** Every CPU file as a Blob, from the store or a resumable download */
storedBlobs: ({ model, signal, onProgress, }: {
    model: ChatModel;
    signal?: AbortSignal;
    onProgress: StartLlmParams[`onProgress`];
}) => Promise<Blob[] | undefined>, 
/** Map built messages to wllama turns */
toWllamaMessages: (messages: EngineMessage[]) => Promise<WllamaMessage[]>, 
/** Start the CPU runtime, the unified engine entry */
startLLM: ({ model, limits, onProgress, signal, logging, assets: overrides, }: StartLlmParams) => Promise<LlmRuntime>, wllamaEngine: LlmEngine;
export { cpuFiles, startLLM, storedBlobs, toWllamaMessages, visionLimits, wllamaEngine, };
