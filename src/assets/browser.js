/** wllama assets shipped next to the bundle, resolved by webpack */
import wllamaWasm from '@wllama/wllama/esm/wasm/wllama.wasm';
import compatWasm from '@wllama/wllama-compat/wasm/wllama.wasm';
import compatWorker from '@wllama/wllama-compat/wasm/wllama.js';
/** LiteRT-LM wasm assets shipped next to the bundle, resolved by webpack */
import litertScript from '@degreesign/litert-wasm/litertlm_wasm_internal.js';
import litertWasm from '@degreesign/litert-wasm/litertlm_wasm_internal.wasm';

/** Default wllama asset URLs, emitted beside the browser bundle */
const defaultWllamaAssets = () => ({
    wasm: wllamaWasm,
    compatWasm,
    compatWorker,
});

/** Default LiteRT asset URLs, emitted beside the browser bundle */
const defaultLitertAssets = () => ({
    script: litertScript,
    wasm: litertWasm,
});

export { defaultLitertAssets, defaultWllamaAssets };
