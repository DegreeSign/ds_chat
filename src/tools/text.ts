/** Named HTML entities found in search markup */
const namedEntities: Record<string, string> = {
    amp: `&`,
    apos: `'`,
    gt: `>`,
    lt: `<`,
    nbsp: ` `,
    quot: `"`,
    hellip: `...`,
    mdash: `-`,
    ndash: `-`,
    ldquo: `"`,
    lsquo: `'`,
    rdquo: `"`,
    rsquo: `'`,
};

/** Largest code point a string can carry */
const maxCodePoint = 0x10ffff;

/** Clamp one numeric setting into a range */
const clampNumber = (
    value: number | undefined,
    min: number,
    max: number,
    fallback: number,
): number =>
    typeof value == `number` && Number.isFinite(value)
        ? Math.min(max, Math.max(min, value))
        : fallback;

/** Decode one entity reference, keeping it when it is unknown */
const decodeEntity = (entity: string): string => {
    if (entity.startsWith(`#`)) {
        const
            hex = entity[1] == `x` || entity[1] == `X`,
            code = parseInt(hex ? entity.slice(2) : entity.slice(1), hex ? 16 : 10);
        return code > 0 && code <= maxCodePoint
            ? String.fromCodePoint(code)
            : entity;
    };
    return namedEntities[entity.toLowerCase()] ?? entity;
};

/** Strip tags, decode entities, collapse whitespace and cap the text */
const plainText = (text: string, max: number): string => {
    const
        decoded = text
            .replace(/<[^>]*>/g, ` `)
            .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi,
                (match, entity: string) => {
                    const value = decodeEntity(entity);
                    return value == entity ? match : value;
                }),
        collapsed = decoded.replace(/\s+/g, ` `).trim();
    return collapsed.slice(0, Math.max(0, max)).trim();
};

export { clampNumber, decodeEntity, plainText };
