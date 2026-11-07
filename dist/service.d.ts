import type { Runtime, RuntimeDeps } from './types';
declare const createRuntime: (deps?: RuntimeDeps) => Runtime, runtime: Runtime;
export { createRuntime, runtime };
