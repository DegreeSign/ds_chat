import type { Runtime, RuntimeDeps } from './types';
declare const createRuntime: (deps?: RuntimeDeps) => Runtime;
declare const runtime: Runtime;
export { createRuntime, runtime };
