import type { ModelStore, ResumePlan, StoredFilePart, StoredPart } from '../types';
declare const 
/** Contiguous parts from offset zero, stopping at the first gap */
chainParts: (parts: StoredFilePart[]) => StoredFilePart[], 
/** Where one response continues the parts, undefined restarts them */
resumePlan: (response: Response, part: StoredPart) => ResumePlan | undefined, 
/** Whether a failed store write means this host cannot use a file store */
isStoreError: (error: unknown) => boolean;
/** Create the resumable file store of one engine */
declare const createModelStore: (dirName: string) => ModelStore;
export { chainParts, createModelStore, isStoreError, resumePlan, };
