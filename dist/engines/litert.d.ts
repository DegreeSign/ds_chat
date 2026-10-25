import type { EngineMessage, LitertMessage, LlmEngine } from '../types';
/** Map built messages to LiteRT turns */
declare const toLitertMessages: (messages: EngineMessage[]) => Promise<LitertMessage[]>;
declare const litertEngine: LlmEngine;
export { litertEngine, toLitertMessages, };
