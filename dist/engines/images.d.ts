import type { EngineMessage, ImageSize } from '../types';
declare const 
/** Vision token target */
imageTokens = 128, 
/** Pixels per vision token */
tokenCell = 32, 
/** Tokens allowed above the target */
tokenSlack = 8;
/** Square size the WebGPU engine encodes */
declare const gpuImageSize: ImageSize;
/** Decode a data URL or fetch a URL into bytes for an engine */
declare const contentBuffer: (url: string) => Promise<ArrayBuffer>;
/** Full-frame size near the token target */
declare const visionSize: (width: number, height: number) => ImageSize;
/** Fit one image URL to the token grid for an engine */
declare const resizeImageUrl: (url: string, size?: ImageSize) => Promise<string>;
/** Fit every image part before an engine sees it */
declare const resizeImages: (messages: EngineMessage[], size?: ImageSize) => Promise<EngineMessage[]>;
export { gpuImageSize, imageTokens, tokenCell, tokenSlack, visionSize, contentBuffer, resizeImageUrl, resizeImages, };
