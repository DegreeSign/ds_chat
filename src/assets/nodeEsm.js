/** wllama assets shipped next to the Node ESM bundle */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { wllamaAssetsAt } from './nodePaths';

/** Default wllama asset paths, resolved beside the Node ESM bundle */
const defaultWllamaAssets = () => wllamaAssetsAt(
    join(dirname(fileURLToPath(import.meta.url)), `../assets/wllama`),
);

export { defaultWllamaAssets };
