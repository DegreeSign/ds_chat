/** wllama and LiteRT assets shipped under one base directory */
import { join } from 'node:path';

const
    /** Default wllama asset paths below a base directory */
    wllamaAssetsAt = base => ({
        wasm: join(base, `wllama.wasm`),
        compatWasm: join(base, `compat/wllama.wasm`),
        compatWorker: join(base, `compat/wllama.js`),
    }),
    /** Default LiteRT asset paths below a base directory */
    litertAssetsAt = base => ({
        script: join(base, `litertlm_wasm_internal.js`),
        wasm: join(base, `litertlm_wasm_internal.wasm`),
    });

export { litertAssetsAt, wllamaAssetsAt };
