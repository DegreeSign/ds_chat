/** wllama assets shipped next to the Node bundle */
import { join } from 'node:path';
import { wllamaAssetsAt } from './nodePaths';

/** Default wllama asset paths, resolved beside the Node bundle */
const defaultWllamaAssets = () =>
    wllamaAssetsAt(join(__dirname, `../assets/wllama`));

export { defaultWllamaAssets };
