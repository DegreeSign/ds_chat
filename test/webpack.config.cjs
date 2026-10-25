// Bundles the browser harness.
// Usage: npx webpack --config test/webpack.config.cjs
const path = require("path");
const webpack = require("webpack");

module.exports = {
    entry: {
        harness: "./test/harness.ts",
    },
    target: "web",
    mode: "development",
    devtool: false,
    resolve: { extensions: [".ts", ".js"] },
    // The harness never starts a real engine, so keep the test bundle small.
    externals: {
        "@wllama/wllama/esm/index.js": "commonjs @wllama/wllama/esm/index.js",
    },
    plugins: [
        new webpack.NormalModuleReplacementPlugin(
            /^\.\.\/assets\/browser$/,
            path.resolve(__dirname, "assets.ts"),
        ),
    ],
    module: {
        rules: [
            {
                test: /\.ts$/,
                use: {
                    loader: "ts-loader",
                    options: { transpileOnly: true, configFile: "tsconfig.test.json" },
                },
                exclude: /node_modules/,
            },
        ],
    },
    output: {
        path: path.resolve(__dirname, "../build"),
        filename: "[name].js",
        publicPath: "",
    },
};
