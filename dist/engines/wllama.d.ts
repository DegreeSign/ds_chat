import type { ChatModel, EngineMessage, LlmEngine, LlmRuntime, StartLlmParams, WllamaMessage } from '../types';
declare const 
/** Image limits of one model */
visionLimits: (model: ChatModel) => {
    image_min_tokens: number;
    image_max_tokens: number;
} | {
    image_min_tokens?: undefined;
    image_max_tokens?: undefined;
}, 
/** CPU file names and URLs */
cpuFiles: (model: ChatModel) => Array<{
    name: string;
    url: string;
}>, 
/** Stored prefix and network blob */
tailBlob: ({ url, stored, storedSize, total, signal, onBytes, }: {
    url: string;
    stored?: Blob;
    storedSize: number;
    total: number;
    signal?: AbortSignal;
    onBytes?: (bytes: number) => void;
}) => Blob, 
/** Stored tails and network blobs */
streamBlobs: (model: ChatModel, signal?: AbortSignal, onBytes?: (bytes: number) => void, onTotal?: (bytes: number) => void) => Promise<Blob[]>, 
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
export { cpuFiles, startLLM, storedBlobs, streamBlobs, tailBlob, toWllamaMessages, visionLimits, wllamaEngine, };
