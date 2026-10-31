import { loadLitert } from './litertLoader';
import type { EngineChunk, EngineMessage, GpuDevice, GpuThrottleParams, LitertMessage, LitertSettings, LitertSettingsParams, LlmEngine, StartLlmParams, StreamLitertParams } from '../types';
declare const 
/** Smallest Gemma 4 vision budget */
visionTokens = 70, 
/** GPU busy share of time */
gpuShare = 0.7, 
/** Most rest per readback */
maxRestMs = 40;
declare const 
/** Rest owed for busy interval */
restFor: (busyMs: number) => number;
/** WebGPU device resting after readback */
declare const throttledDevice: ({ device, pace, }: GpuThrottleParams) => GpuDevice;
/** Drop device and wasm module */
declare const releaseDevice: (mod: Awaited<ReturnType<typeof loadLitert>>) => void;
/** Cache one file per URL */
declare const cacheModel: (url: string, cache: Cache, signal: AbortSignal | undefined, onProgress: StartLlmParams[`onProgress`]) => Promise<void>;
/** Map messages to LiteRT turns */
declare const toLitertMessages: (messages: EngineMessage[], keepMedia?: boolean) => Promise<LitertMessage[]>;
/** Whether conversation holds incoming history */
declare const continuesHistory: (sent: EngineMessage[], history: EngineMessage[]) => boolean;
/** Stream LiteRT reply as chunks */
declare const streamLitert: ({ engine, mod, params, messages, session, }: StreamLitertParams) => AsyncGenerator<EngineChunk>;
/** Engine settings with vision budget */
declare const litertSettings: ({ model, limits, contextSize, source, mod, }: LitertSettingsParams) => LitertSettings;
declare const litertEngine: LlmEngine;
export { cacheModel, continuesHistory, gpuShare, litertEngine, litertSettings, maxRestMs, releaseDevice, restFor, streamLitert, throttledDevice, toLitertMessages, visionTokens, };
