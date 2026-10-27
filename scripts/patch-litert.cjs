/** Appends the console filter to the shipped LiteRT glue */
const { readFileSync, writeFileSync } = require(`node:fs`);

const
    /** Emitted glue, copied from @litert-lm/core by webpack */
    glue = `dist/assets/litert/litertlm_wasm_internal.js`,
    /** Marker of an already patched file */
    token = `dsLiteRtFilter`,
    /** Filter block appended after the upstream factory */
    patch = `\n;(() => {\n`
        + `    const factory = ModuleFactory;\n`
        + `    const benign = /not found for (backend constraints|prefer activation type)/;\n`
        + `    const sink = write => (...args) => {\n`
        + `        if (!benign.test(args.join(' '))) write(...args);\n`
        + `    };\n`
        + `    ModuleFactory = function dsLiteRtFilter(config = {}) {\n`
        + `        return factory({\n`
        + `            ...config,\n`
        + `            print: config.print ?? sink(console.log.bind(console)),\n`
        + `            printErr: config.printErr ?? sink(console.error.bind(console)),\n`
        + `        });\n`
        + `    };\n`
        + `})();\n`;
const source = readFileSync(glue, `utf8`);

if (source.includes(token)) console.log(`litert glue already filtered`);
else {
    writeFileSync(glue, source + patch);
    console.log(`litert glue filtered`);
}
