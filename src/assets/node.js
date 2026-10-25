/** wllama and LiteRT assets shipped next to the Node bundle */
import { join } from 'node:path';
import { litertAssetsAt, wllamaAssetsAt } from './nodePaths';

/** Default wllama asset paths, resolved beside the Node bundle */
const defaultWllamaAssets = () =>
    wllamaAssetsAt(join(__dirname, `../assets/wllama`));

/** Default LiteRT asset paths, resolved beside the Node bundle */
const defaultLitertAssets = () =>
    litertAssetsAt(join(__dirname, `../assets/litert`));

export { defaultLitertAssets, defaultWllamaAssets };
