/** Load the on-device engine on demand, kept out of the main bundle.
 * ts-loader only compiles .ts files, so this import() call stays dynamic.
 * wllama is imported from its built ESM bundle because its package main is missing. */
export const loadWllama = () => import(
    /* webpackChunkName: "engine-wllama" */ `@wllama/wllama/esm/index.js`
);
