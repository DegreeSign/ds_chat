import type { LitertAssets, WllamaAssets } from '../src/types';

/** Stub wllama asset resolver */
const defaultWllamaAssets = (): WllamaAssets => ({
    wasm: `stub://wllama.wasm`,
    compatWasm: `stub://compat/wllama.wasm`,
    compatWorker: `stub://compat/wllama.js`,
});

/** Stub LiteRT asset resolver */
const defaultLitertAssets = (): LitertAssets => ({
    script: `stub://litert.js`,
    wasm: `stub://litert.wasm`,
});

export { defaultLitertAssets, defaultWllamaAssets };
