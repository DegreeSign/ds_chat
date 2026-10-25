import type * as wllama from '@wllama/wllama/esm/index.js';

declare const loadWllama: () => Promise<typeof wllama>;

export { loadWllama };
