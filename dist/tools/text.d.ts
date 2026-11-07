declare const 
/** Clamp numeric setting into range */
clampNumber: (value: number | undefined, min: number, max: number, fallback: number) => number, 
/** Decode entity, keep unknown ones */
decodeEntity: (entity: string) => string, 
/** Strip tags, decode, collapse, cap */
plainText: (text: string, max: number) => string;
export { clampNumber, decodeEntity, plainText };
