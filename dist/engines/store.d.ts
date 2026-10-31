import type { ModelStore, ResumePlan, StoredFilePart, StoredPart } from '../types';
declare const 
/** Contiguous parts until first gap */
chainParts: (parts: StoredFilePart[]) => StoredFilePart[], 
/** Where response continues parts */
resumePlan: (response: Response, part: StoredPart) => ResumePlan | undefined, 
/** Whether store failure disables storage */
isStoreError: (error: unknown) => boolean;
/** Create engine resumable file store */
declare const createModelStore: (dirName: string) => ModelStore;
export { chainParts, createModelStore, isStoreError, resumePlan, };
