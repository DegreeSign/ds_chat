// Headless Chromium driver for the real-weight switch check.
// Build first: npx webpack --config test/webpack.switch.config.cjs
// Usage: CHROME_BIN=chromium node test/switch.cjs [port] [debugPort]
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const
    BROWSER = process.env.CHROME_BIN || "chromium",
    ROOT = path.resolve(__dirname, ".."),
    BUNDLE_DIR = path.join(ROOT, "build/switch"),
    MODEL_DIR = process.env.LIVE_MODELS || path.join(ROOT, "build/models"),
    PORT = Number(process.argv[2] || 17546),
    DEBUG_PORT = Number(process.argv[3] || 9336),
    PROFILE = process.env.SWITCH_PROFILE
        || `${os.homedir()}/snap/chromium/common/ds_chat_switch_chrome`,
    TIMEOUT_MS = Number(process.env.SWITCH_TIMEOUT_MS || 1800000),
    MIME = {
        ".html": "text/html",
        ".mjs": "text/javascript",
        ".js": "text/javascript",
        ".wasm": "application/wasm",
        ".gguf": "application/octet-stream",
        ".litertlm": "application/octet-stream",
    },
    PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>switch</title></head>
<body>
<pre id="results">running</pre>
<script>
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    const url = typeof input == "string" ? input : input?.url ?? "";
    const match = /^https:\\/\\/huggingface\\.co\\/[^/]+\\/[^/]+\\/resolve\\/main\\/(.+)$/
        .exec(url);
    const target = match ? "/models/" + match[1] : input;
    const response = realFetch(target, init);
    console.info("FETCH " + (match ? match[1] : url));
    return response;
};
if (navigator.gpu) {
    const adapter = navigator.gpu.requestAdapter.bind(navigator.gpu);
    window.__gpu = { adapters: 0, devices: 0, lost: [] };
    navigator.gpu.requestAdapter = async (...args) => {
        const found = await adapter(...args);
        window.__gpu.adapters += 1;
        let info = "none";
        if (found) {
            try {
                info = JSON.stringify({
                    vendor: found.info?.vendor,
                    architecture: found.info?.architecture,
                    device: found.info?.device,
                    description: found.info?.description,
                    fallback: found.isFallbackAdapter,
                    features: [...found.features].slice(0, 8),
                    maxBufferSize: found.limits.maxBufferSize,
                    subgroups: found.features.has("subgroups"),
                    shaderF16: found.features.has("shader-f16"),
                });
            } catch (error) { info = "info error " + error; }
        }
        console.info("ADAPTER " + window.__gpu.adapters + " " + info);
        if (found) {
            const request = found.requestDevice.bind(found);
            found.requestDevice = async (...rest) => {
                const device = await request(...rest);
                window.__gpu.devices += 1;
                device.lost.then(info => {
                    window.__gpu.lost.push(info.reason + ":" + info.message);
                });
                console.info("DEVICE " + window.__gpu.devices);
                return device;
            };
        }
        return found;
    };
}
window.addEventListener("error", event => {
    console.log("PAGE_ERROR", event.error?.stack || event.message);
});
window.addEventListener("unhandledrejection", event => {
    console.log("PAGE_REJECTION", event.reason?.stack || String(event.reason));
});
</script>
<script type="module">
import "/switch.mjs";
</script>
</body>
</html>
`;

const rangeOf = (req, size) => {
    const header = req.headers.range;
    if (!header) return undefined;
    const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
    if (!match) return undefined;
    const
        start = Number(match[1]),
        end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) return { invalid: true };
    return { start, end };
};

const serve = () => new Promise(resolve => {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent((req.url || "/").split("?")[0]);
        if (url == "/" || url == "/index.html") {
            res.writeHead(200, {
                "content-type": "text/html",
                "cross-origin-opener-policy": "same-origin",
                "cross-origin-embedder-policy": "require-corp",
                "cache-control": "no-store",
            });
            res.end(PAGE);
            return;
        }
        const
            relative = url.replace(/^\/+/, ""),
            models = relative.startsWith("models/"),
            base = models ? MODEL_DIR : BUNDLE_DIR,
            file = path.join(base, relative.replace(/^models\//, ""));
        if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            res.end("not found");
            return;
        }
        const
            size = fs.statSync(file).size,
            range = rangeOf(req, size),
            headers = {
                "content-type": MIME[path.extname(file)] || "application/octet-stream",
                "accept-ranges": "bytes",
                "cross-origin-opener-policy": "same-origin",
                "cross-origin-embedder-policy": "require-corp",
                "cache-control": "no-store",
            };
        if (range?.invalid) {
            res.writeHead(416, { "content-range": `bytes */${size}` });
            res.end();
            return;
        }
        if (range) {
            res.writeHead(206, {
                ...headers,
                "content-range": `bytes ${range.start}-${range.end}/${size}`,
                "content-length": `${range.end - range.start + 1}`,
            });
            fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
            return;
        }
        res.writeHead(200, { ...headers, "content-length": `${size}` });
        fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", error => {
        console.error("server error", error.message);
        process.exit(4);
    });
});

const
    sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
    getJson = url => new Promise((resolve, reject) => {
        http.get(url, res => {
            let data = "";
            res.on("data", chunk => (data += chunk));
            res.on("end", () => {
                try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
            });
        }).on("error", reject);
    });

const main = async () => {
    if (!fs.existsSync(path.join(BUNDLE_DIR, "switch.mjs"))) {
        console.error("missing bundle, run the switch webpack config first");
        process.exit(5);
    }
    if (!fs.existsSync(MODEL_DIR)) {
        console.error("missing model directory", MODEL_DIR);
        process.exit(5);
    }
    const server = await serve();
    fs.mkdirSync(PROFILE, { recursive: true });
    const chrome = spawn(BROWSER, [
        "--headless=new",
        "--no-sandbox",
        "--disable-dev-shm-usage",
        "--enable-unsafe-webgpu",
        "--enable-features=Vulkan,WebGPU",
        "--use-angle=vulkan",
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${PROFILE}`,
        "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore"] });

    let target;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !target) {
        try {
            const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            target = list.find(entry => entry.type === "page");
        } catch { }
        if (!target) await sleep(300);
    }
    if (!target) {
        console.error("chromium did not expose a page target");
        chrome.kill();
        server.close();
        process.exit(2);
    }

    const
        ws = new WebSocket(target.webSocketDebuggerUrl),
        pending = new Map(),
        send = (method, params = {}) => new Promise(resolve => {
            const id = ++send.id;
            pending.set(id, resolve);
            ws.send(JSON.stringify({ id, method, params }));
        });
    send.id = 0;

    const opened = new Promise((resolve, reject) => {
        ws.addEventListener("open", resolve);
        ws.addEventListener("error", reject);
    });
    ws.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message.result);
            pending.delete(message.id);
            return;
        }
        if (message.method === "Runtime.consoleAPICalled") {
            const text = (message.params.args || [])
                .map(arg => arg.value ?? arg.description ?? "").join(" ");
            console.log(text);
        }
        if (message.method === "Runtime.exceptionThrown") {
            console.error("EXCEPTION " + (message.params.exceptionDetails
                .exception?.description || ""));
        }
    });
    await opened;
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: `http://127.0.0.1:${PORT}/` });

    const started = Date.now();
    let report;
    while (Date.now() - started < TIMEOUT_MS) {
        const result = await send("Runtime.evaluate", {
            expression: `document.getElementById("results")?.textContent || ""`,
            returnByValue: true,
        });
        const text = result?.result?.value || "";
        if (text.startsWith("{") && text.endsWith("}")) {
            try {
                const parsed = JSON.parse(text);
                if (parsed.done) { report = parsed; break; }
            } catch { }
        }
        await sleep(2000);
    }

    chrome.kill();
    server.close();
    if (!report) {
        console.error(`no report within ${TIMEOUT_MS} ms`);
        process.exit(3);
    }
    const failed = (report.steps || []).filter(step => !step.ok);
    console.log(JSON.stringify(report, null, 2));
    console.log(failed.length ? `FAIL ${failed.length}` : "PASS");
    process.exit(failed.length ? 1 : 0);
};

main().catch(error => {
    console.error(error?.stack || error);
    process.exit(1);
});
