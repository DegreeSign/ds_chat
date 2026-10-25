import type { EngineMessage, LitertMessage, LlmEngine, StartLlmParams } from '../types';
/** Fetch one model file into the cache, once per URL */
declare const cacheModel: (url: string, cache: Cache, signal: AbortSignal | undefined, onProgress: StartLlmParams[`onProgress`]) => Promise<void>;
/** Map built messages to LiteRT turns */
declare const toLitertMessages: (messages: EngineMessage[]) => Promise<LitertMessage[]>;
declare const litertEngine: LlmEngine;
export { cacheModel, litertEngine, toLitertMessages, };
