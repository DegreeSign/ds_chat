/** wllama and LiteRT assets shipped next to the Node ESM bundle */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { litertAssetsAt, wllamaAssetsAt } from './nodePaths';

const
    /** Default wllama asset paths, resolved beside the Node ESM bundle */
    defaultWllamaAssets = () => wllamaAssetsAt(
        join(dirname(fileURLToPath(import.meta.url)), `../assets/wllama`),
    ),
    /** Default LiteRT asset paths, resolved beside the Node ESM bundle */
    defaultLitertAssets = () => litertAssetsAt(
        join(dirname(fileURLToPath(import.meta.url)), `../assets/litert`),
    );

export { defaultLitertAssets, defaultWllamaAssets };
