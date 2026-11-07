/** wllama and LiteRT assets shipped next to the Node bundle */
import { join } from 'node:path';
import { litertAssetsAt, wllamaAssetsAt } from './nodePaths';

const
    /** Default wllama asset paths, resolved beside the Node bundle */
    defaultWllamaAssets = () =>
        wllamaAssetsAt(join(__dirname, `../assets/wllama`)),
    /** Default LiteRT asset paths, resolved beside the Node bundle */
    defaultLitertAssets = () =>
        litertAssetsAt(join(__dirname, `../assets/litert`));

export { defaultLitertAssets, defaultWllamaAssets };
