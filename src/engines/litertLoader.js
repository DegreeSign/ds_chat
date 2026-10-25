/** Load the WebGPU engine on demand, kept out of the main bundle.
 * ts-loader only compiles .ts files, so this import() call stays dynamic. */
export const loadLitert = () => import(
    /* webpackChunkName: "engine-litert" */ `@litert-lm/core`
);
