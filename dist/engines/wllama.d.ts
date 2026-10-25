import type { EngineMessage, LlmEngine, LlmRuntime, StartLlmParams, WllamaMessage } from '../types';
/** CPU threads after the hardware maximum and the caller cap */
declare const cpuThreads: (cores: number, maxThreads: number) => number;
declare const 
/** Map built messages to wllama turns */
toWllamaMessages: (messages: EngineMessage[]) => Promise<WllamaMessage[]>, 
/** Start the CPU runtime, the unified engine entry */
startLLM: ({ model, limits, onProgress, signal, logging, assets: overrides, }: StartLlmParams) => Promise<LlmRuntime>, wllamaEngine: LlmEngine;
export { cpuThreads, startLLM, toWllamaMessages, wllamaEngine, };
