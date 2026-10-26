/** Clamp one numeric setting into a range */
declare const clampNumber: (value: number | undefined, min: number, max: number, fallback: number) => number;
/** Decode one entity reference, keeping it when it is unknown */
declare const decodeEntity: (entity: string) => string;
/** Strip tags, decode entities, collapse whitespace and cap the text */
declare const plainText: (text: string, max: number) => string;
export { clampNumber, decodeEntity, plainText };
