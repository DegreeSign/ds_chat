import type { ToolWithImplementation } from '@litert-lm/core';
import type { ChatModel, ChatTool, EngineChunk, EngineMessage, LitertChatParams, LitertGpu, LitertMessage, LitertSettings, LitertSettingsParams, LlmEngine, LlmLimits, StartLlmParams, StreamLitertParams } from '../types';
declare const 
/** Smallest Gemma 4 vision budget in tokens */
visionTokens = 70;
/** Watch the live device, marking the engine dead when it is lost */
declare const watchDevice: (gpu: LitertGpu) => void;
/** Fetch one model file into the cache, once per URL */
declare const cacheModel: (url: string, cache: Cache, signal: AbortSignal | undefined, onProgress: StartLlmParams[`onProgress`]) => Promise<void>;
/** Open the model file, from a store, the cache or the network */
declare const openSource: ({ url, signal, onProgress, }: {
    url: string;
    signal?: AbortSignal;
    onProgress: StartLlmParams[`onProgress`];
}) => Promise<ReadableStream<Uint8Array>>;
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
/** Stream one reply on a started GPU runtime */
declare const chatOn: ({ gpu, model, params, session, }: LitertChatParams) => Promise<string | undefined>;
/** Build one engine settings object with the small vision budget */
declare const litertSettings: ({ model, limits, source, mod, contextTokens, }: LitertSettingsParams) => LitertSettings;
/** Rebuild the engine on a fresh device after a loss */
declare const rebuildGpu: (gpu: LitertGpu, model: ChatModel, limits: LlmLimits) => Promise<void>;
declare const litertEngine: LlmEngine;
export { cacheModel, chatOn, continuesHistory, engineTool, litertEngine, litertSettings, openSource, rebuildGpu, sameTools, streamLitert, toLitertMessages, toolRounds, visionTokens, watchDevice, };
