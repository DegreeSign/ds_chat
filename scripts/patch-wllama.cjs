/** Patches the installed wllama build */
const { readFileSync, writeFileSync } = require(`node:fs`);
const path = require(`node:path`);

const
    file = path.join(
        __dirname,
        `..`,
        `node_modules`,
        `@wllama`,
        `wllama`,
        `esm`,
        `index.js`,
    ),
    /** Pre-spawned workers per engine thread */
    poolFactor = 2,
    poolPattern = /this\.useMultiThread \? nbThreads(?: \* \d+)? : 0,/,
    poolTo = `this.useMultiThread ? nbThreads * ${poolFactor} : 0,`,
    /** Stream queue promises stay handled */
    queuePattern = new RegExp(
        `new Promise\\(\\(res, rej\\) => \\{\\n` +
        `(\\s+)resolve = res;\\n\\s+reject = rej;\\n(\\s+)\\}\\)`,
        `g`,
    ),
    queueTo = `keepHandled(new Promise`,
    helperMarker = `var keepHandled = `,
    helper = `/** Keeps abandoned stream errors handled */\n` +
        `var keepHandled = (promise) => (promise.catch(() => { }), promise);\n`;

/** Count pattern matches */
const matches = (source, pattern) => source.match(pattern)?.length ?? 0;

const original = readFileSync(file, `utf8`);
let source = original;

// size the worker pool
if (!source.includes(poolTo)) {
    if (!poolPattern.test(source)) {
        console.error(`wllama pool patch does not match, update the patch`);
        process.exit(1);
    }
    source = source.replace(poolPattern, poolTo);
};

// keep the queue promise errors handled
if (!source.includes(queueTo)) {
    if (matches(source, queuePattern) != 2) {
        console.error(`wllama queue patch does not match, update the patch`);
        process.exit(1);
    }
    if (!source.includes(helperMarker))
        source = source.replace(
            `var cbToAsyncIter = `,
            helper + `var cbToAsyncIter = `,
        );
    source = source.replace(queuePattern, match => `keepHandled(${match})`);
};

if (source == original) {
    console.log(`wllama patches already applied`);
    process.exit(0);
}
writeFileSync(file, source);
console.log(`wllama patches applied`);
