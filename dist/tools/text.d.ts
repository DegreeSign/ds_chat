/** Clamp numeric setting into range */
declare const clampNumber: (value: number | undefined, min: number, max: number, fallback: number) => number;
/** Decode entity, keep unknown ones */
declare const decodeEntity: (entity: string) => string;
/** Strip tags, decode, collapse, cap */
declare const plainText: (text: string, max: number) => string;
export { clampNumber, decodeEntity, plainText };
