import type { EngineMessage, ImageSize } from '../types';
declare const 
/** Vision token target */
imageTokens = 128, 
/** Pixels per vision token */
tokenCell = 32, 
/** Tokens allowed above the target */
tokenSlack = 8, 
/** Square size for WebGPU encoding */
gpuImageSize: ImageSize, 
/** Decode URL into engine bytes */
contentBuffer: (url: string) => Promise<ArrayBuffer>, 
/** Full-frame size near token target */
visionSize: (width: number, height: number, tokens?: number) => ImageSize, 
/** Fit image to token grid */
resizeImageUrl: (url: string, size?: ImageSize, tokens?: number) => Promise<string>, 
/** Fit image parts before engine */
resizeImages: (messages: EngineMessage[], size?: ImageSize, tokens?: number) => Promise<EngineMessage[]>;
export { gpuImageSize, imageTokens, tokenCell, tokenSlack, visionSize, contentBuffer, resizeImageUrl, resizeImages, };
