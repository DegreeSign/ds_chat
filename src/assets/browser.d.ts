/** Type declarations for the bundled engine asset resolvers */
import type { LitertAssets, WllamaAssets } from '../types';

declare const defaultWllamaAssets: () => WllamaAssets;
declare const defaultLitertAssets: () => LitertAssets;

export { defaultLitertAssets, defaultWllamaAssets };
