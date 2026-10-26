import * as path from "path";
import * as webpack from "webpack";
import TerserPlugin from "terser-webpack-plugin";

const
    /** engine binaries emitted next to the bundles, shared by every target */
    assetRules: webpack.RuleSetRule[] = [
        {
            test: /@wllama\/wllama-compat\/wasm\/wllama\.wasm$/,
            type: `asset/resource`,
            generator: { filename: `../assets/wllama/compat/wllama.wasm` },
        },
        {
            test: /@wllama\/wllama-compat\/wasm\/wllama\.js$/,
            type: `asset/resource`,
            generator: { filename: `../assets/wllama/compat/wllama.js` },
        },
        {
            test: /@wllama\/wllama\/esm\/wasm\/wllama\.wasm$/,
            type: `asset/resource`,
            generator: { filename: `../assets/wllama/wllama.wasm` },
        },
        {
            test: /@litert-lm\/core\/wasm\/litertlm_wasm_internal\.(js|wasm)$/,
            type: `asset/resource`,
            generator: { filename: `../assets/litert/[name][ext]` },
        },
    ],
    // Shared webpack configuration
    commonConfig: webpack.Configuration = {
        resolve: {
            extensions: [`.ts`, `.js`],
            alias: {
                '@degreesign/litert-wasm': path.resolve(
                    __dirname,
                    `node_modules/@litert-lm/core/wasm`,
                ),
            },
        },
        module: {
            rules: [
                {
                    test: /\.ts$/,
                    use: {
                        loader: `ts-loader`,
                        options: {
                            compilerOptions: {
                                declaration: false,
                                declarationMap: false,
                                module: `ESNext`,
                            },
                        },
                    },
                    exclude: /node_modules/,
                },
                ...assetRules,
            ],
        },
        plugins: [
            new webpack.BannerPlugin({
                banner: `/*! MIT License. DegreeSign Chat SDK */`,
                raw: true,
            }),
        ],
        optimization: {
            minimize: true,
            minimizer: [new TerserPlugin()],
            usedExports: true,
            sideEffects: false,
        },
        // the engine binaries are large by design
        performance: { hints: false },
        mode: `production`,
    },
    // Browser webpack configuration
    browserConfig: webpack.Configuration = {
        ...commonConfig,
        entry: `./src/index.ts`,
        target: `web`,
        experiments: {
            outputModule: true,
        },
        output: {
            path: path.resolve(__dirname, `dist/browser`),
            filename: `chat.min.mjs`,
            chunkFilename: `[name].min.mjs`,
            library: { type: `module` },
            module: true,
            chunkFormat: `module`,
            publicPath: `auto`,
        },
    },
    /** Node resolution, shared by the CommonJS and ESM targets */
    nodeResolve: webpack.ResolveOptions = {
        ...commonConfig.resolve,
        mainFields: [`module`, `main`],
        conditionNames: [`import`, `default`],
        aliasFields: [],
        preferRelative: true,
    },
    /** Node plugins, swapping the browser asset module for a path resolver */
    nodePlugins = (assets: string) => [
        ...(commonConfig.plugins ?? []),
        new webpack.NormalModuleReplacementPlugin(
            /^\.\.\/assets\/browser$/,
            path.resolve(__dirname, assets),
        ),
    ],
    /** Shared Node target, the module output differs per format */
    nodeBase: webpack.Configuration = {
        ...commonConfig,
        entry: `./src/index.ts`,
        target: `node`,
        resolve: nodeResolve,
    },
    // Node CommonJS webpack configuration
    nodeConfig: webpack.Configuration = {
        ...nodeBase,
        plugins: nodePlugins(`src/assets/node.js`),
        output: {
            path: path.resolve(__dirname, `dist/node`),
            filename: `chat.node.min.js`,
            chunkFilename: `[name].node.min.js`,
            libraryTarget: `commonjs2`,
            globalObject: `typeof globalThis !== 'undefined' ? globalThis : this`,
        },
        node: {
            __dirname: false,
            __filename: false,
        },
    },
    // Node ESM webpack configuration
    nodeEsmConfig: webpack.Configuration = {
        ...nodeBase,
        experiments: {
            outputModule: true,
        },
        plugins: nodePlugins(`src/assets/nodeEsm.js`),
        output: {
            path: path.resolve(__dirname, `dist/node`),
            filename: `chat.node.min.mjs`,
            chunkFilename: `[name].node.min.mjs`,
            library: { type: `module` },
            module: true,
            chunkFormat: `module`,
            publicPath: `auto`,
        },
    };

module.exports = [browserConfig, nodeConfig, nodeEsmConfig];
