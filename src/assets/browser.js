/** wllama assets shipped next to the bundle, resolved by webpack */
import wllamaWasm from '@wllama/wllama/esm/wasm/wllama.wasm';
import compatWasm from '@wllama/wllama-compat/wasm/wllama.wasm';
import compatWorker from '@wllama/wllama-compat/wasm/wllama.js';

/** Default wllama asset URLs, emitted beside the browser bundle */
const defaultWllamaAssets = () => ({
    wasm: wllamaWasm,
    compatWasm,
    compatWorker,
});

export { defaultWllamaAssets };
