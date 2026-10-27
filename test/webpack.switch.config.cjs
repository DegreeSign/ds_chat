// Bundles the real-weight switch check, engines included.
// Usage: npx webpack --config test/webpack.switch.config.cjs
const path = require("path");

module.exports = {
    entry: "./test/switch.ts",
    target: "web",
    mode: "production",
    devtool: false,
    experiments: { outputModule: true },
    resolve: {
        extensions: [".ts", ".js"],
        alias: {
            "@degreesign/litert-wasm": path.resolve(
                __dirname,
                "../node_modules/@litert-lm/core/wasm",
            ),
        },
    },
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: "ts-loader",
                    options: {
                        transpileOnly: true,
                        configFile: "tsconfig.test.json",
                        compilerOptions: {
                            module: "ESNext",
                            noEmit: false,
                        },
                    },
                },
                exclude: /node_modules/,
            },
            {
                test: /@wllama\/wllama-compat\/wasm\/wllama\.wasm$/,
                type: "asset/resource",
                generator: { filename: "assets/wllama/compat/wllama.wasm" },
            },
            {
                test: /@wllama\/wllama-compat\/wasm\/wllama\.js$/,
                type: "asset/resource",
                generator: { filename: "assets/wllama/compat/wllama.js" },
            },
            {
                test: /@wllama\/wllama\/esm\/wasm\/wllama\.wasm$/,
                type: "asset/resource",
                generator: { filename: "assets/wllama/wllama.wasm" },
            },
            {
                test: /@litert-lm\/core\/wasm\/litertlm_wasm_internal\.(js|wasm)$/,
                type: "asset/resource",
                generator: { filename: "assets/litert/[name][ext]" },
            },
        ],
    },
    optimization: {
        minimize: true,
        usedExports: true,
        sideEffects: false,
    },
    performance: { hints: false },
    output: {
        path: path.resolve(__dirname, "../build/switch"),
        filename: "switch.mjs",
        chunkFilename: "chunk-[name].mjs",
        publicPath: "auto",
        library: { type: "module" },
        module: true,
        chunkFormat: "module",
    },
};
