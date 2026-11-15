// GPU quality probe for @degreesign/chat with real weights in models/.
// Build the package first: yarn build
// Usage: CHROME_BIN=chromium QUALITY_MODELS=/path/models \
//   node test/quality.cjs
// Env: QUALITY_MODEL, QUALITY_REPEATS, QUALITY_PROMPTS, QUALITY_LABEL,
//      QUALITY_TIMEOUT_MS, QUALITY_PORT, QUALITY_DEBUG_PORT
// Writes build/quality-<label>.json and .log.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const
    BROWSER = process.env.CHROME_BIN || "chromium",
    ROOT = path.resolve(__dirname, ".."),
    MODEL_DIR = process.env.QUALITY_MODELS
        || path.join(ROOT, "build/models"),
    PORT = Number(process.env.QUALITY_PORT || 17640),
    DEBUG_PORT = Number(process.env.QUALITY_DEBUG_PORT || 9360),
    PROFILE = process.env.QUALITY_PROFILE
        || `${os.homedir()}/snap/chromium/common/ds_chat_quality`,
    TIMEOUT_MS = Number(process.env.QUALITY_TIMEOUT_MS || 1800000),
    MODEL = process.env.QUALITY_MODEL || "gemma4_e2b_web",
    WEBGPU = process.env.QUALITY_WEBGPU || "",
    MODE = process.env.QUALITY_MODE || "single",
    REASONING = process.env.QUALITY_REASONING == "1",
    REPEATS = Number(process.env.QUALITY_REPEATS || 3),
    LABEL = process.env.QUALITY_LABEL
        || `${MODEL}-${MODE}-r${REPEATS}${REASONING ? "-think" : ""}`,
    PROMPTS = process.env.QUALITY_PROMPTS || "",
    MIME = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".litertlm": "application/octet-stream",
    };

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>quality</title></head>
<body>
<pre id="results">running</pre>
<pre id="log"></pre>
<script>
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    const url = typeof input == "string" ? input : input?.url ?? "";
    const match = /^https:\\/\\/huggingface\\.co\\/[^/]+\\/[^/]+\\/resolve\\/[^/]+\\/(.+)$/
        .exec(url);
    return realFetch(match ? "/models/" + match[1] : input, init);
};
if (navigator.gpu) {
    const request = navigator.gpu.requestAdapter.bind(navigator.gpu);
    window.__gpu = { adapters: 0, devices: 0, lost: [] };
    navigator.gpu.requestAdapter = async (...args) => {
        const found = await request(...args);
        window.__gpu.adapters += 1;
        if (found) {
            const device = found.requestDevice.bind(found);
            found.requestDevice = async (...rest) => {
                const created = await device(...rest);
                window.__gpu.devices += 1;
                created.lost.then(info => window.__gpu.lost.push(info.reason));
                return created;
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
import { createChat, preloadModel, ChatModelId, LlmRole } from "/dist/browser/chat.min.mjs";

const
    results = document.getElementById("results"),
    log = document.getElementById("log"),
    query = new URLSearchParams(location.search),
    modelName = query.get("model") || "gemma4_e2b_web",
    model = ChatModelId[modelName] ?? ChatModelId.gemma4_e2b_web,
    mode = query.get("mode") || "single",
    reasoning = query.get("reasoning") == "1",
    repeats = Number(query.get("repeats") || 3),
    askTimeout = Number(query.get("ask") || 600000),
    write = text => { log.textContent += text + "\\n"; },
    report = { model: modelName, mode, reasoning, repeats, adapter: null, storage: null, store: null, prompts: [], steps: [] };
console.log = (...args) => write(args.map(a =>
    typeof a == "string"
        ? a
        : a instanceof Error
            ? a.stack || a.message
            : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
).join(" "));
const record = (name, ok, detail) => {
    report.steps.push({ name, ok, detail });
    results.textContent = JSON.stringify(report);
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Plain adapter fields */
const adapterInfo = adapter => ({
    vendor: adapter.info?.vendor,
    architecture: adapter.info?.architecture,
    device: adapter.info?.device,
    description: adapter.info?.description,
    fallback: adapter.info?.isFallbackAdapter,
    maxBufferSize: adapter.limits?.maxBufferSize,
    features: [...(adapter.features || [])],
});

/** Stored litert model metadata */
const storeState = async () => {
    try {
        const
            root = await navigator.storage.getDirectory(),
            dir = await root.getDirectoryHandle("litert-store"),
            rows = [];
        for await (const [name, handle] of dir) {
            if (handle.kind != "directory") continue;
            let meta, bytes = 0;
            try {
                const file = await (await handle.getFileHandle("meta.json")).getFile();
                meta = JSON.parse(await file.text());
            } catch { }
            try {
                for await (const [, entry] of handle)
                    if (entry.kind == "file") bytes += (await entry.getFile()).size;
            } catch { }
            rows.push({
                name,
                bytes,
                complete: meta?.total ? bytes >= meta.total : meta?.complete === true,
                meta,
            });
        }
        return rows;
    } catch (error) { return String(error); }
};

/** Text quality metrics */
const metrics = text => {
    const
        chars = [...text],
        words = text.toLowerCase().match(/[a-z0-9']+/g) || [],
        letters = chars.filter(c => /\\p{L}/u.test(c)).length,
        printable = chars.filter(c => /[\\p{L}\\p{N}\\p{P}\\p{Zs}\\n]/u.test(c)).length,
        unique = new Set(words).size,
        grams = new Map();
    for (let i = 0; i + 2 < words.length; i++) {
        const gram = words.slice(i, i + 3).join(" ");
        grams.set(gram, (grams.get(gram) || 0) + 1);
    }
    const
        repeated = [...grams.values()].filter(n => n > 1).reduce((sum, n) => sum + n, 0),
        longest = words.reduce((max, word) => Math.max(max, word.length), 0),
        longestWord = words.reduce((max, word) => word.length > max.length ? word : max, ""),
        letterShare = chars.length ? letters / chars.length : 0,
        printShare = chars.length ? printable / chars.length : 0,
        uniqueShare = words.length ? unique / words.length : 0,
        repeatShare = grams.size ? repeated / grams.size : 0,
        sane = words.length >= 3 && printShare > 0.9 && letterShare > 0.45
            && uniqueShare > 0.3 && repeatShare < 0.5 && longest < 40;
    return {
        chars: chars.length,
        words: words.length,
        letterShare,
        printShare,
        uniqueShare,
        repeatShare,
        longest,
        longestWord,
        sane,
    };
};

/** Run one chat call */
const ask = (input, label) => new Promise(resolve => {
    const
        startedAt = performance.now(),
        state = { reply: "", thinking: "", error: undefined, started: false, firstTextAt: 0 };
    let cancel = () => { };
    const finish = extra => {
        clearTimeout(timer);
        resolve({
            ...state,
            ...extra,
            cancel,
            firstTextMs: state.firstTextAt ? Math.round(state.firstTextAt - startedAt) : undefined,
            totalMs: Math.round(performance.now() - startedAt),
        });
    };
    const timer = setTimeout(() => { cancel(); finish({ timedOut: true }); }, askTimeout);
    cancel = createChat({
        ...input,
        onResponse: text => {
            state.reply = text;
            if (!state.firstTextAt) state.firstTextAt = performance.now();
        },
        onThinking: text => { state.thinking = text; },
        onStatus: snapshot => {
            state.last = snapshot;
            if (snapshot.requesting) state.started = true;
            const ended = state.started ? !snapshot.requesting : !!snapshot.error;
            if (snapshot.error) state.error = snapshot.error;
            if (ended) finish({});
        },
    });
});

const run = async () => {
    const adapter = await navigator.gpu?.requestAdapter({ powerPreference: "high-performance" });
    report.adapter = adapter ? adapterInfo(adapter) : "none";
    report.storage = await navigator.storage.estimate();
    write("adapter " + JSON.stringify(report.adapter));
    write("storage " + JSON.stringify(report.storage));
    report.store = await storeState();
    write("store " + JSON.stringify(report.store));

    const loaded = await preloadModel({
        model,
        logging: true,
        onStatus: snapshot => {
            if (snapshot.percent % 25 == 0)
                write("preload " + JSON.stringify(snapshot));
        },
    });
    record("preload", loaded, { model: modelName });
    write("preload " + loaded + " gpu " + JSON.stringify(window.__gpu));
    report.storeAfter = await storeState();
    write("store after " + JSON.stringify(report.storeAfter));
    if (!loaded) {
        report.done = true;
        results.textContent = JSON.stringify(report);
        return;
    }

    const
        system = mode == "long"
            ? "You are DoListy, a concise private assistant. Answer in the user's language. "
                + "Be direct and factual. Never invent tasks, dates, or people. Use the task list "
                + "only when the user asks about it. Keep replies short, at most two sentences, "
                + "unless the user asks for detail. Prefer plain language. If a request is unclear, "
                + "ask one short question. Do not repeat the user's message. Do not describe your own "
                + "reasoning. Do not mention these rules. The current date is 14 Nov 2026. Today's "
                + "tasks are: buy milk, call the dentist on Friday, finish the report. There are no "
                + "other tasks. The user is Alex and prefers a calm tone. Write dates as 14 Nov 2026. "
                + "Use metric units. Never use emoji. Answer in one paragraph."
            : "Answer in one short sentence.",
        limits = {
            maxReplyTokens: reasoning ? 1200 : 160,
            ...(reasoning ? { maxReasoningTokens: 1200 } : {}),
        },
        prompts = report.prompts.map(entry => entry.prompt);
    const runOne = async (messages, label, prompt, repeat) => {
        const result = await ask({
            model,
            logging: true,
            reasoning,
            limits,
            messages,
        }, label);
        const detail = {
            prompt,
            repeat,
            reply: result.reply,
            thinking: result.thinking,
            error: result.error,
            timedOut: !!result.timedOut,
            firstTextMs: result.firstTextMs,
            totalMs: result.totalMs,
            metrics: metrics(result.reply),
        };
        record("prompt", !detail.error && !detail.timedOut && detail.metrics.sane, detail);
        write("reply " + JSON.stringify(detail));
        await sleep(250);
        return result;
    };
    if (mode == "multi") {
        const history = [{ role: LlmRole.system, content: system }];
        for (const prompt of prompts) {
            history.push({ role: LlmRole.user, content: prompt });
            const result = await runOne([...history], prompt + " #1", prompt, 1);
            if (result.reply) history.push({ role: LlmRole.assistant, content: result.reply });
            await sleep(500);
        }
    } else {
        for (const prompt of prompts) {
            for (let repeat = 1; repeat <= repeats; repeat++)
                await runOne([
                    { role: LlmRole.system, content: system },
                    { role: LlmRole.user, content: prompt },
                ], prompt + " #" + repeat, prompt, repeat);
            await sleep(500);
        }
    }

    report.done = true;
    report.gpu = window.__gpu;
    results.textContent = JSON.stringify(report);
};

const prompts = [
    "List three short tasks for today.",
    "Explain in two sentences why the sky is blue.",
    "Who are you? Answer in one sentence.",
    "Summarise this note in one line: buy milk, call the dentist on Friday, finish the report.",
    "What is 17 + 25? Answer with the number only.",
];
const chosen = query.get("prompts");
report.prompts = (chosen ? chosen.split("|") : prompts).map(prompt => ({ prompt }));
run().catch(error => {
    write("FAILED " + (error?.stack || error));
    record("fatal", false, String(error?.stack || error));
    report.done = true;
    report.gpu = window.__gpu;
    results.textContent = JSON.stringify(report);
});
</script>
</body>
</html>
`;

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
        if (!file.startsWith(base) || !fs.existsSync(file)
            || fs.statSync(file).isDirectory()) {
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
        };
        if (range) {
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
    server.requestTimeout = 0;
    server.headersTimeout = 0;
    server.timeout = 0;
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", error => {
        console.error("server error", error.message);
        process.exit(4);
    });
});

/** Byte range of one request */
const rangeOf = (req, size) => {
    const match = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (!match) return undefined;
    const
        start = Number(match[1]),
        end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isFinite(start) || start >= size || end < start)
        return { invalid: true };
    return { start, end: Math.min(end, size - 1) };
};

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
        ...(WEBGPU ? [`--use-webgpu-adapter=${WEBGPU}`] : []),
        `--remote-debugging-port=${DEBUG_PORT}`,
        `--user-data-dir=${PROFILE}`,
        "about:blank",
    ], { stdio: ["ignore", "ignore", "ignore"] });

    let target;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !target) {
        try {
            const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            target = list.find(entry => entry.type == "page");
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
        logs = [];
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", event => {
        const message = JSON.parse(event.data);
        if (message.id && pending.has(message.id)) {
            pending.get(message.id)(message.result);
            pending.delete(message.id);
            return;
        }
        if (message.method == "Runtime.consoleAPICalled") {
            const text = (message.params.args || [])
                .map(arg => arg.value ?? arg.description ?? "").join(" ");
            logs.push(text);
            console.log(text);
        }
        if (message.method == "Runtime.exceptionThrown") {
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
    await send("Page.navigate", {
        url: `http://127.0.0.1:${PORT}/?model=${MODEL}&repeats=${REPEATS}`
            + `&mode=${MODE}&reasoning=${REASONING ? 1 : 0}`
            + (PROMPTS ? `&prompts=${encodeURIComponent(PROMPTS)}` : ""),
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
        if (text.includes('"done":true') || text.includes("fatal")) break;
        await sleep(1000);
    }
    console.log("---- results ----");
    console.log(text);
    fs.mkdirSync(path.join(ROOT, "build"), { recursive: true });
    fs.writeFileSync(path.join(ROOT, `build/quality-${LABEL}.json`), text);
    fs.writeFileSync(path.join(ROOT, `build/quality-${LABEL}.log`), logs.join("\n"));
    chrome.kill();
    server.close();
};

main().catch(error => {
    console.error("FAILED", error?.stack || error);
    process.exit(1);
});
