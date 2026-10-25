/** Banner and license for the shipped wllama assets */
const { copyFileSync, readFileSync, writeFileSync } = require(`node:fs`);

const
    version = JSON.parse(
        readFileSync(`node_modules/@wllama/wllama-compat/package.json`, `utf8`)
    ).version,
    worker = `dist/assets/wllama/compat/wllama.js`,
    banner =
        `/*! @wllama/wllama-compat ${version} | MIT License`
        + ` | https://github.com/ngxson/wllama`
        + ` | https://cdn.jsdelivr.net/npm/@wllama/wllama-compat@${version}/wasm/wllama.js */\n`;

writeFileSync(worker, banner + readFileSync(worker, `utf8`));
copyFileSync(
    `node_modules/@wllama/wllama/LICENCE`,
    `dist/assets/wllama/LICENCE`,
);
console.log(`wllama ${version} assets bannered`);
