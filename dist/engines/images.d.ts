import type { EngineMessage } from '../types';
/** Square image side sent to an engine, a multiple of 48 */
declare const imageSide = 288;
/** Decode a data URL or fetch a URL into bytes for an engine */
declare const contentBuffer: (url: string) => Promise<ArrayBuffer>;
/** Center-crop one image URL to a square and resize it for an engine */
declare const resizeImageUrl: (url: string) => Promise<string>;
/** Center-crop and resize every image part before an engine sees it */
declare const resizeImages: (messages: EngineMessage[]) => Promise<EngineMessage[]>;
export { imageSide, contentBuffer, resizeImageUrl, resizeImages, };
