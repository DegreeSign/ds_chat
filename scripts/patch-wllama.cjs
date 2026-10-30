/** Sizes the installed wllama worker pool for both ggml pools */
const { readFileSync, writeFileSync } = require(`node:fs`);
const path = require(`node:path`);

const
    /** Pre-spawned workers per engine thread */
    poolFactor = 2,
    file = path.join(
        __dirname,
        `..`,
        `node_modules`,
        `@wllama`,
        `wllama`,
        `esm`,
        `index.js`,
    ),
    original = readFileSync(file, `utf8`),
    pattern = /this\.useMultiThread \? nbThreads(?: \* \d+)? : 0,/,
    to = `this.useMultiThread ? nbThreads * ${poolFactor} : 0,`;

if (original.includes(to)) {
    console.log(`wllama pool patch already applied`);
    process.exit(0);
}
if (!pattern.test(original)) {
    console.error(`wllama pool patch does not match, update the patch`);
    process.exit(1);
}
writeFileSync(file, original.replace(pattern, to));
console.log(`wllama pool patch applied`);
