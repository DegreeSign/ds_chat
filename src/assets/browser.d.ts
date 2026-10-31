/** Types for bundled asset resolvers */
import type { LitertAssets, WllamaAssets } from '../types';

declare const defaultWllamaAssets: () => WllamaAssets;
declare const defaultLitertAssets: () => LitertAssets;

export { defaultLitertAssets, defaultWllamaAssets };
