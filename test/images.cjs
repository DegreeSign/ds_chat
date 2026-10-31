// Builds and runs the manual image harness against llama.cpp.
// Needs the server on http://127.0.0.1:8080 and fixtures in build/test.
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status || 1);
};

run("npx", ["webpack", "--config", "test/webpack.config.cjs"]);
run("node", [
    "test/drive.cjs",
    "build",
    "17545",
    "9335",
    `${os.homedir()}/snap/chromium/common/ds_chat_chrome`,
    "600000",
    "images.js",
]);
