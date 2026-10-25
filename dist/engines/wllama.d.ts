import type { EngineMessage, LlmEngine, LlmRuntime, StartLlmParams, WllamaMessage } from '../types';
/** CPU threads after the hardware maximum and the caller cap */
declare const cpuThreads: (cores: number, maxThreads: number) => number;
declare const 
/** Decode an image URL into bytes for wllama */
imageBuffer: (url: string) => Promise<ArrayBuffer>, 
/** Map built messages to wllama turns */
toWllamaMessages: (messages: EngineMessage[]) => Promise<WllamaMessage[]>, 
/** Whether any turn carries an image */
hasImages: (messages: EngineMessage[]) => boolean, 
/** Start the CPU runtime, the unified engine entry */
startLLM: ({ model, limits, onProgress, signal, logging, assets: overrides, }: StartLlmParams) => Promise<LlmRuntime>, wllamaEngine: LlmEngine;
export { cpuThreads, hasImages, imageBuffer, startLLM, toWllamaMessages, wllamaEngine, };
