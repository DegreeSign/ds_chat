import type { ResumePlan, StoredFilePart, StoredModel, StoredPart, StoreDownloadParams } from '../types';
declare const 
/** Contiguous parts from offset zero, stopping at the first gap */
chainParts: (parts: StoredFilePart[]) => StoredFilePart[], 
/** Where one response continues the parts, undefined restarts them */
resumePlan: (response: Response, part: StoredPart) => ResumePlan | undefined;
declare const 
/** Stored bytes and metadata of one model file, undefined when absent */
storedModel: (url: string) => Promise<StoredModel | undefined>, 
/** Download one model file, resuming the parts already stored */
downloadModel: ({ url, signal, onProgress, }: StoreDownloadParams) => Promise<StoredModel | undefined>, 
/** Delete one stored model file and its metadata */
removeModel: (url: string) => Promise<void>, 
/** Delete the whole store directory and every model file in it */
purgeModels: () => Promise<void>;
export { chainParts, downloadModel, purgeModels, removeModel, resumePlan, storedModel, };
