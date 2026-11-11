import { loadLitert } from './litertLoader';
import type { EngineChunk, EngineMessage, GpuDevice, GpuThrottleParams, LitertMessage, LitertSettings, LitertSettingsParams, LlmEngine, StartLlmParams, StreamLitertParams } from '../types';
declare const 
/** Smallest Gemma 4 vision budget */
visionTokens = 70, 
/** GPU busy share of time */
gpuShare = 1, 
/** Most rest per readback */
maxRestMs = 500;
declare const 
/** Rest owed for busy interval */
restFor: (busyMs: number, share?: number) => number, 
/** WebGPU device resting after readback */
throttledDevice: ({ device, pace, }: GpuThrottleParams) => GpuDevice, 
/** Drop device and wasm module */
releaseDevice: (mod: Awaited<ReturnType<typeof loadLitert>>) => void, 
/** Cache one file per URL */
cacheModel: (url: string, cache: Cache, signal: AbortSignal | undefined, onProgress: StartLlmParams[`onProgress`]) => Promise<void>, 
/** Map messages to LiteRT turns */
toLitertMessages: (messages: EngineMessage[], keepMedia?: boolean) => Promise<LitertMessage[]>, 
/** Whether conversation holds incoming history */
continuesHistory: (sent: EngineMessage[], history: EngineMessage[]) => boolean, 
/** Stream LiteRT reply as chunks */
streamLitert: ({ engine, mod, params, messages, maxTokens, session, }: StreamLitertParams) => AsyncGenerator<EngineChunk>, 
/** Engine settings with vision budget */
litertSettings: ({ model, limits, contextSize, source, mod, }: LitertSettingsParams) => LitertSettings, litertEngine: LlmEngine;
export { cacheModel, continuesHistory, gpuShare, litertEngine, litertSettings, maxRestMs, releaseDevice, restFor, streamLitert, throttledDevice, toLitertMessages, visionTokens, };
