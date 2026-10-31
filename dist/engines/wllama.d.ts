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
/** CPU file names and URLs */
cpuFiles: (model: ChatModel) => Array<{
    name: string;
    url: string;
}>, 
/** CPU files as stored blobs */
storedBlobs: ({ model, signal, onProgress, }: {
    model: ChatModel;
    signal?: AbortSignal;
    onProgress: StartLlmParams[`onProgress`];
}) => Promise<Blob[] | undefined>, 
/** Map messages to wllama turns */
toWllamaMessages: (messages: EngineMessage[]) => Promise<WllamaMessage[]>, 
/** Start CPU runtime engine entry */
startLLM: ({ model, limits, onProgress, signal, logging, assets: overrides, }: StartLlmParams) => Promise<LlmRuntime>, wllamaEngine: LlmEngine;
export { cpuFiles, startLLM, storedBlobs, toWllamaMessages, visionLimits, wllamaEngine, };
