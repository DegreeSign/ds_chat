/** wllama assets shipped under one base directory */
import { join } from 'node:path';

/** Default wllama asset paths below a base directory */
const wllamaAssetsAt = base => ({
    wasm: join(base, `wllama.wasm`),
    compatWasm: join(base, `compat/wllama.wasm`),
    compatWorker: join(base, `compat/wllama.js`),
});

export { wllamaAssetsAt };
