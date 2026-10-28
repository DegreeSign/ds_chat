// Live browser check for @degreesign/chat with real weights in build/models.
// Build the package first: yarn build
// Usage: CHROME_BIN=chromium node test/live.cjs [port] [debugPort] [model]
// Optional: LIVE_ONLY=text,image,audio LIVE_TIMEOUT_MS=...
// The Gemma 4 GPU model covers text, image and audio. The Qwen CPU model
// covers text and images; its projector shares the model thread budget.
// The limited Gemma build covers text only.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const BROWSER = process.env.CHROME_BIN || "chromium";
const ROOT = path.resolve(__dirname, "..");
const PORT = Number(process.argv[2] || 17545);
const DEBUG_PORT = Number(process.argv[3] || 9335);
const PROFILE = process.env.LIVE_PROFILE
    || `${os.homedir()}/snap/chromium/common/ds_chat_live_chrome`;
const TIMEOUT_MS = Number(process.env.LIVE_TIMEOUT_MS || 900000);
const MODEL_DIR = process.env.LIVE_MODELS || path.join(ROOT, "build/models");

const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".wav": "audio/wav",
    ".gguf": "application/octet-stream",
    ".litertlm": "application/octet-stream",
};

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>live</title></head>
<body>
<pre id="results">running</pre>
<pre id="log"></pre>
<script>
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    const url = typeof input == "string" ? input : input?.url ?? "";
    const match = /^https:\\/\\/huggingface\\.co\\/[^/]+\\/[^/]+\\/resolve\\/main\\/(.+)$/
        .exec(url);
    return realFetch(match ? "/models/" + match[1] : input, init);
};
window.addEventListener("error", event => {
    console.log("PAGE_ERROR", event.error?.stack || event.message);
});
window.addEventListener("unhandledrejection", event => {
    console.log("PAGE_REJECTION", event.reason?.stack || String(event.reason));
});
</script>
<script type="module">
import { createChat, preloadModel, ChatModelId, LlmRole } from "/dist/browser/chat.min.mjs";

const
    results = document.getElementById("results"),
    log = document.getElementById("log"),
    query = new URLSearchParams(location.search),
    threads = Number(query.get("threads") || 0),
    askTimeout = Number(query.get("ask") || 1200000),
    write = text => { log.textContent += text + "\\n"; };
console.log = (...args) => write(args.map(a =>
    typeof a == "string"
        ? a
        : a instanceof Error
            ? a.stack || a.message
            : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
).join(" "));

const report = { steps: [] };
const record = (name, ok, detail) => {
    report.steps.push({ name, ok, detail });
    results.textContent = JSON.stringify(report);
};

/** Short 16 kHz mono WAV of a spoken word, or a tone. */
const wavDataUrl = (seconds, hz) => {
    const rate = 16000;
    const count = Math.floor(rate * seconds);
    const buffer = new ArrayBuffer(44 + count * 2);
    const view = new DataView(buffer);
    const text = (at, value) => {
        for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i));
    };
    text(0, "RIFF"); view.setUint32(4, 36 + count * 2, true);
    text(8, "WAVE"); text(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true);
    view.setUint16(22, 1, true); view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true);
    view.setUint16(34, 16, true); text(36, "data");
    view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) {
        const fade = Math.min(1, i / 200, (count - i) / 200);
        view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * hz * i / rate) * 12000 * fade, true);
    }
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return "data:audio/wav;base64," + btoa(binary);
};

const imageDataUrl = (color, size = 96) => {
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
    return canvas.toDataURL("image/png");
};

/** Run one chat call and wait for the end snapshot. */
const ask = (input, label) => new Promise(resolve => {
    const
        startedAt = performance.now(),
        state = {
            reply: "",
            thinking: "",
            statuses: [],
            error: undefined,
            started: false,
            firstTextAt: undefined,
        };
    let cancel = () => { };
    const finish = extra => {
        clearTimeout(timer);
        resolve({
            ...state,
            ...extra,
            firstTextMs: state.firstTextAt
                ? Math.round(state.firstTextAt - startedAt)
                : undefined,
        });
    };
    const timer = setTimeout(() => {
        cancel();
        finish({ timedOut: true });
    }, askTimeout);
    cancel = createChat({
        ...input,
        onResponse: text => {
            state.reply = text;
            if (!state.firstTextAt) {
                state.firstTextAt = performance.now();
                write(label + " first text "
                    + Math.round(state.firstTextAt - startedAt) + " ms");
            }
            write(label + " reply: " + text.slice(0, 160).replace(/\\n/g, " "));
        },
        onThinking: text => { state.thinking = text; },
        onStatus: snapshot => {
            state.statuses.push(snapshot);
            state.last = snapshot;
            if (snapshot.requesting) state.started = true;
            if (state.lastPercent != snapshot.percent) {
                state.lastPercent = snapshot.percent;
                write(label + " status: " + JSON.stringify(snapshot));
            }
            const ended = state.started
                ? !snapshot.requesting
                : !!snapshot.error;
            if (ended) finish();
        },
    });
});

const run = async () => {
    write("crossOriginIsolated=" + crossOriginIsolated
        + " gpu=" + typeof navigator.gpu
        + " cores=" + navigator.hardwareConcurrency
        + " threads=" + (threads || "default"));
    const adapter = await navigator.gpu?.requestAdapter();
    write("adapter=" + (adapter ? adapter.info.vendor + " " + adapter.info.architecture : "none"));

    const model = query.get("model") || "gemma4_e2b";
    const chosen = model == "qwen3_vl_2b"
        ? ChatModelId.qwen3_vl_2b
        : model == "qwen3_vl_2b_instruct"
            ? ChatModelId.qwen3_vl_2b_instruct
            : model == "qwen3_vl_2b_instruct_q3"
                ? ChatModelId.qwen3_vl_2b_instruct_q3
                : model == "gemma4_e2b_limited"
                    ? ChatModelId.gemma4_e2b_limited
                    : ChatModelId.gemma4_e2b;
    const state = {};
    write("model=" + model);
    const loaded = await preloadModel({
        model: chosen,
        logging: true,
        ...(threads ? { limits: { maxThreads: threads } } : {}),
        onStatus: snapshot => {
            state.lastPreload = snapshot;
            if (snapshot.percent % 25 == 0)
                write("preload: " + JSON.stringify(snapshot));
        },
    });
    write("preload=" + loaded + " " + JSON.stringify(state.lastPreload));
    record("preload", loaded, state.lastPreload || null);
    if (!loaded) {
        report.done = true;
        results.textContent = JSON.stringify(report);
        return;
    }

    const replyBudget = { maxReplyTokens: 320 };
    const only = query.get("only");
    const wanted = name => !only || only.split(",").includes(name);
    const timed = async (name, work) => {
        if (!wanted(name)) return;
        const start = performance.now();
        await work();
        write(name + " elapsed " + Math.round(performance.now() - start) + " ms");
    };

    await timed("text", async () => {
        const text = await ask({
            model: chosen,
            logging: true,
            limits: replyBudget,
            messages: [
                { role: LlmRole.system, content: "Answer in one short sentence." },
                { role: LlmRole.user, content: "What is the capital of France?" },
            ],
        }, "text");
        record("text", !!text.reply && !text.last?.error, {
            reply: text.reply.slice(0, 120),
            error: text.last?.error,
            timedOut: text.timedOut,
        });
    });

    await timed("image", async () => {
        if (model == "gemma4_e2b_limited") {
            // the limited build has no vision encoder, an image-only turn is rejected
            const rejected = await ask({
                model: chosen,
                logging: true,
                limits: replyBudget,
                messages: [{
                    role: LlmRole.user,
                    content: "",
                    images: [imageDataUrl("#cc0000")],
                }],
            }, "image");
            record("image", rejected.last?.error == "Model does not accept images",
                { error: rejected.last?.error });
            return;
        }
        const image = await ask({
            model: chosen,
            logging: true,
            limits: replyBudget,
            messages: [{
                role: LlmRole.user,
                content: "What color fills this image? Answer with one word.",
                images: [imageDataUrl("#cc0000")],
            }],
        }, "image");
        record("image", !!image.reply && !image.last?.error, {
            reply: image.reply.slice(0, 120),
            error: image.last?.error,
            timedOut: image.timedOut,
            firstTextMs: image.firstTextMs,
        });
    });

    await timed("audio", async () => {
        const audioInput = {
            model: chosen,
            logging: true,
            limits: replyBudget,
            messages: [{
                role: LlmRole.user,
                content: "Describe the sound in one short sentence.",
                audio: [wavDataUrl(1, 440)],
            }],
        };
        if (model == "qwen3_vl_2b" || model == "gemma4_e2b_limited") {
            // the CPU and limited builds have no audio encoder
            const rejected = await ask({
                ...audioInput,
                messages: [{
                    role: LlmRole.user,
                    content: "",
                    audio: [wavDataUrl(1, 440)],
                }],
            }, "audio");
            record("audio", rejected.last?.error == "Model does not accept audio",
                { error: rejected.last?.error });
            return;
        }
        const audio = await ask(audioInput, "audio");
        record("audio", !!audio.reply && !audio.last?.error, {
            reply: audio.reply.slice(0, 120),
            error: audio.last?.error,
            timedOut: audio.timedOut,
        });
    });

    write("DONE");
    report.done = true;
    results.textContent = JSON.stringify(report);
};

run().catch(error => {
    write("FAILED " + (error?.stack || error));
    record("fatal", false, String(error?.stack || error));
    report.done = true;
    results.textContent = JSON.stringify(report);
});
</script>
</body>
</html>
`;

const rangeOf = (req, size) => {
    const header = req.headers.range;
    if (!header) return undefined;
    const match = /^bytes=(\d+)-(\d*)$/.exec(header.trim());
    if (!match) return undefined;
    const start = Number(match[1]);
    const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
    if (start > end || start >= size) return { invalid: true };
    return { start, end };
};

const serve = () => new Promise(resolve => {
    const server = http.createServer((req, res) => {
        const url = decodeURIComponent((req.url || "/").split("?")[0]);
        if (url == "/index.html" || url == "/") {
            res.writeHead(200, {
                "content-type": "text/html",
                "cross-origin-opener-policy": "same-origin",
                "cross-origin-embedder-policy": "require-corp",
                "cache-control": "no-store",
            });
            res.end(PAGE);
            return;
        }
        const relative = url.replace(/^\/+/, "");
        const base = relative.startsWith("models/") ? MODEL_DIR : ROOT;
        const file = path.join(base, relative.replace(/^models\//, ""));
        if (!file.startsWith(base) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404);
            res.end("not found");
            return;
        }
        const size = fs.statSync(file).size;
        const range = rangeOf(req, size);
        if (range?.invalid) {
            res.writeHead(416, { "content-range": `bytes */${size}` });
            res.end();
            return;
        }
        const headers = {
            "content-type": MIME[path.extname(file)] || "application/octet-stream",
            "accept-ranges": "bytes",
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-embedder-policy": "require-corp",
            "cache-control": "no-store",
        };        if (range) {
            headers["content-range"] = `bytes ${range.start}-${range.end}/${size}`;
            headers["content-length"] = `${range.end - range.start + 1}`;
            res.writeHead(206, headers);
            fs.createReadStream(file, { start: range.start, end: range.end }).pipe(res);
            return;
        }
        headers["content-length"] = `${size}`;
        res.writeHead(200, headers);
        fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", error => {
        console.error("server error", error.message);
        process.exit(4);
    });
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => {
    http.get(url, res => {
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
            try { resolve(JSON.parse(data)); } catch (error) { reject(error); }
        });
    }).on("error", reject);
});

const main = async () => {
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

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    const logs = [];
    let id = 0;
    const pending = new Map();
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
            logs.push(text);
            console.log(text);
        }
        if (message.method === "Runtime.exceptionThrown") {
            const details = message.params.exceptionDetails;
            const text = "EXCEPTION " + (details.exception?.description
                || details.text || JSON.stringify(details));
            logs.push(text);
            console.log(text);
        }
    });
    const send = (method, params = {}) => new Promise(resolve => {
        const messageId = ++id;
        pending.set(messageId, resolve);
        ws.send(JSON.stringify({ id: messageId, method, params }));
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws open timeout")), 10000);
        ws.addEventListener("open", () => { clearTimeout(timer); resolve(); });
    });
    await send("Runtime.enable");
    await send("Page.enable");
    const model = process.argv[4] || "gemma4_e2b";
    const only = process.env.LIVE_ONLY || "";
    const page = process.env.LIVE_PAGE || "index.html";
    await send("Page.navigate", {
        url: `http://127.0.0.1:${PORT}/${page}?model=${model}`
            + (only ? `&only=${only}` : "")
            + (process.env.LIVE_QUERY ? `&${process.env.LIVE_QUERY}` : ""),
    });

    const start = Date.now();
    let text = "running";
    while (Date.now() - start < TIMEOUT_MS) {
        const result = await send("Runtime.evaluate", {
            expression: "document.getElementById('results')?.textContent ?? 'running'",
            returnByValue: true,
            awaitPromise: true,
        });
        text = result?.result?.value || "running";
        if (text.includes('"done":true') || text.includes("fatal")
            || text.includes('"ok":false')) break;
        await sleep(1000);
    }
    console.log("---- results ----");
    console.log(text);
    const logText = await send("Runtime.evaluate", {
        expression: "document.getElementById('log')?.textContent ?? ''",
        returnByValue: true,
    });
    console.log("---- page log ----");
    console.log(logText?.result?.value || "(empty)");
    ws.close();
    chrome.kill();
    server.close();
    let report;
    try { report = JSON.parse(text); } catch { process.exit(1); }
    process.exit(report.steps.every(step => step.ok) ? 0 : 1);
};

main().catch(error => {
    console.error(error);
    process.exit(3);
});
