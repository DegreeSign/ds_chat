/** Stub wllama asset resolver for the browser test bundle */
const defaultWllamaAssets = () => ({
    wasm: `stub://wllama.wasm`,
    compatWasm: `stub://compat/wllama.wasm`,
    compatWorker: `stub://compat/wllama.js`,
});

export { defaultWllamaAssets };
