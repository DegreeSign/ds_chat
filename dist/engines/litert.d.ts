import type { ToolWithImplementation } from '@litert-lm/core';
import type { ChatTool, EngineChunk, EngineMessage, LitertMessage, LitertSettings, LitertSettingsParams, LlmEngine, StartLlmParams, StreamLitertParams } from '../types';
declare const 
/** Smallest Gemma 4 vision budget in tokens */
visionTokens = 70;
/** Fetch one model file into the cache, once per URL */
declare const cacheModel: (url: string, cache: Cache, signal: AbortSignal | undefined, onProgress: StartLlmParams[`onProgress`]) => Promise<void>;
/** Map built messages to LiteRT turns */
declare const toLitertMessages: (messages: EngineMessage[], keepMedia?: boolean) => Promise<LitertMessage[]>;
/** Whether the live conversation already holds the incoming history */
declare const continuesHistory: (sent: EngineMessage[], history: EngineMessage[]) => boolean;
/** Clamp the tool round budget of one reply */
declare const toolRounds: (value?: number) => number;
/** Map one host or built-in tool to the engine tool shape */
declare const engineTool: (tool: ChatTool) => ToolWithImplementation;
/** Whether two lists declare the same tools and the same functions */
declare const sameTools: (first?: ChatTool[], next?: ChatTool[]) => boolean;
/** Stream one LiteRT reply as engine chunks */
declare const streamLitert: ({ engine, mod, params, messages, session, }: StreamLitertParams) => AsyncGenerator<EngineChunk>;
/** Build one engine settings object with the small vision budget */
declare const litertSettings: ({ model, limits, source, mod, }: LitertSettingsParams) => LitertSettings;
declare const litertEngine: LlmEngine;
export { cacheModel, continuesHistory, engineTool, litertEngine, litertSettings, sameTools, streamLitert, toLitertMessages, toolRounds, visionTokens, };
