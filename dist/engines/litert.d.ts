import type { EngineChunk, EngineMessage, LitertMessage, LlmEngine, StartLlmParams, StreamLitertParams } from '../types';
/** Fetch one model file into the cache, once per URL */
declare const cacheModel: (url: string, cache: Cache, signal: AbortSignal | undefined, onProgress: StartLlmParams[`onProgress`]) => Promise<void>;
/** Map built messages to LiteRT turns */
declare const toLitertMessages: (messages: EngineMessage[], keepImages?: boolean) => Promise<LitertMessage[]>;
/** Whether the live conversation already holds the incoming history */
declare const continuesHistory: (sent: EngineMessage[], history: EngineMessage[]) => boolean;
/** Stream one LiteRT reply as engine chunks */
declare const streamLitert: ({ engine, mod, params, messages, session, }: StreamLitertParams) => AsyncGenerator<EngineChunk>;
declare const litertEngine: LlmEngine;
export { cacheModel, continuesHistory, litertEngine, streamLitert, toLitertMessages, };
