// Headless CPU benchmark.
// Build first: yarn build
// Usage: CHROME_BIN=chromium node test/cpu-bench.cjs
// Env: BENCH_THREADS, BENCH_LABEL, BENCH_PORT, BENCH_DEBUG_PORT,
//      BENCH_MODEL, BENCH_REPLY, BENCH_IMAGE, BENCH_TIMEOUT_MS, BENCH_ONLY
// Writes build/cpu-bench-<label>.json, CPU sampled from /proc.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

const
    BROWSER = process.env.CHROME_BIN || "chromium",
    ROOT = path.resolve(__dirname, ".."),
    PORT = Number(process.env.BENCH_PORT || 17560),
    DEBUG_PORT = Number(process.env.BENCH_DEBUG_PORT || 9340),
    PROFILE = process.env.BENCH_PROFILE
        || `${os.homedir()}/snap/chromium/common/ds_chat_cpu_bench`,
    TIMEOUT_MS = Number(process.env.BENCH_TIMEOUT_MS || 600000),
    MODEL_DIR = process.env.BENCH_MODELS || path.join(ROOT, "build/models"),
    THREADS = Number(process.env.BENCH_THREADS || 2),
    LABEL = process.env.BENCH_LABEL || `threads-${THREADS}`,
    MODEL = process.env.BENCH_MODEL || "qwen3_vl_2b_instruct",
    REPLY = Number(process.env.BENCH_REPLY || 400),
    IMAGE = process.env.BENCH_IMAGE || "/models/coco_sample.png",
    ONLY = process.env.BENCH_ONLY || "",
    HZ = Number(execSync("getconf CLK_TCK").toString().trim()) || 100,
    MIME = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".wav": "audio/wav",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gguf": "application/octet-stream",
        ".litertlm": "application/octet-stream",
    };

const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>cpu-bench</title></head>
<body>
<pre id="results">running</pre>
<pre id="log"></pre>
<script>
const realFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const match = /^https:\\/\\/huggingface\\.co\\/[^/]+\\/[^/]+\\/resolve\\/main\\/(.+)$/
        .exec(url);
    return realFetch(match ? "/models/" + match[1] : input, init);
};
window.addEventListener("error", event => {
    console.log("PAGE_ERROR " + (event.error?.stack || event.message));
});
window.addEventListener("unhandledrejection", event => {
    console.log("PAGE_REJECTION " + (event.reason?.stack || String(event.reason)));
});
</script>
<script type="module">
import { createChat, preloadModel, ChatModelId, LlmRole } from "/dist/browser/chat.min.mjs";

const
    log = document.getElementById("log"),
    results = document.getElementById("results"),
    query = new URLSearchParams(location.search),
    threads = Number(query.get("threads") || 0),
    reply = Number(query.get("reply") || 400),
    only = query.get("only") || "",
    image = query.get("image") || "/models/coco_sample.png",
    modelName = query.get("model") || "qwen3_vl_2b_instruct",
    model = ChatModelId[modelName] ?? ChatModelId.qwen3_vl_2b_instruct,
    report = { label: query.get("label") || "", steps: [], done: false },
    write = text => {
        log.textContent += text + "\\n";
        if (log.textContent.length > 400000)
            log.textContent = log.textContent.slice(-200000);
    },
    record = (name, ok, detail) => {
        report.steps.push({ name, ok, detail });
        results.textContent = JSON.stringify(report);
    };

console.log = (...args) => write(args.map(a =>
    typeof a === "string"
        ? a
        : a instanceof Error
            ? a.stack || a.message
            : (() => { try { return JSON.stringify(a); } catch { return String(a); } })()
).join(" "));

// the app prompt, src/describe.ts
const imageSystem = [
    "Write fully detailed, factual image descriptions for low-vision readers.",
    "Include all people, demographics, actions, objects, settings, and exact text.",
    "Output only the raw description with no intro, title, or disclaimer.",
    "Even if the main subject in the image is controversial mention it first.",
    'Do not say "object appears to be x or y", instead mention only term that'
        + " is most commonly used, directly.",
    'Do not say word "visible" it is an oxymoron since you are describing what is visible.',
    "Use direct, plain English without filtering or vague words.",
].join(" ");
const imageNote = "describe this image in one sentence starting with the main subject";

const askModel = (target, prompt, timeoutMs) => new Promise(resolve => {
    const startedAt = performance.now();
    let
        firstTextAt = 0,
        text = "",
        started = false,
        settled = false;
    const finish = extra => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({
            ...extra,
            text,
            firstTextMs: firstTextAt
                ? Math.round(firstTextAt - startedAt)
                : undefined,
            totalMs: Math.round(performance.now() - startedAt),
        });
    };
    const timer = setTimeout(() => finish({ timedOut: true }), timeoutMs);
    createChat({
        model: target,
        logging: true,
        reasoning: false,
        messages: [{ role: LlmRole.user, content: prompt }],
        onResponse: value => {
            if (!firstTextAt) firstTextAt = performance.now();
            text = value;
        },
        onStatus: snapshot => {
            if (snapshot.requesting) started = true;
            if (snapshot.error) finish({ error: snapshot.error });
            else if (started && !snapshot.requesting) finish({});
        },
    });
});

const runResident = async () => {
    const
        cpuModel = ChatModelId.qwen3_vl_2b_instruct,
        gpuModel = ChatModelId.gemma4_e2b_limited,
        prompt = "What is the capital of France? Answer in one word.";
    let cpuLoadMs = 0, gpuLoadMs = 0;
    let startedAt = performance.now();
    const cpuLoaded = await preloadModel({ model: cpuModel, logging: true });
    cpuLoadMs = Math.round(performance.now() - startedAt);
    startedAt = performance.now();
    const gpuLoaded = await preloadModel({ model: gpuModel, logging: true });
    gpuLoadMs = Math.round(performance.now() - startedAt);
    const cpu = await askModel(cpuModel, prompt, 180000);
    const gpu = await askModel(gpuModel, prompt, 180000);
    write("resident cpu load " + cpuLoadMs + " gpu load " + gpuLoadMs);
    write("resident cpu chat " + JSON.stringify(cpu));
    write("resident gpu chat " + JSON.stringify(gpu));
    record("resident", cpuLoaded && gpuLoaded && !!cpu.text && !!gpu.text, {
        cpuLoadMs,
        gpuLoadMs,
        cpu,
        gpu,
    });
    report.done = true;
    results.textContent = JSON.stringify(report);
};

const run = async () => {
    record("capabilities", true, {
        crossOriginIsolated,
        cores: navigator.hardwareConcurrency,
        threads,
        model: modelName,
        reply,
        image,
    });
    if (only == "resident") {
        await runResident();
        return;
    };
    write("capabilities " + JSON.stringify({
        crossOriginIsolated,
        cores: navigator.hardwareConcurrency,
        threads,
        model: modelName,
        uaMobile: navigator.userAgentData?.mobile,
        ua: navigator.userAgent,
        touch: navigator.maxTouchPoints,
    }));

    const loadStarted = performance.now();
    const loaded = await preloadModel({
        model,
        logging: true,
        ...(threads ? { limits: { maxThreads: threads } } : {}),
        onStatus: snapshot => {
            if (snapshot.percent % 25 == 0)
                write("preload " + JSON.stringify(snapshot));
        },
    });
    const loadMs = Math.round(performance.now() - loadStarted);
    write("load " + loaded + " " + loadMs + " ms");
    record("load", loaded, { loadMs });
    if (!loaded || only == "load") {
        report.done = true;
        results.textContent = JSON.stringify(report);
        return;
    };

    let chunks = 0, text = "", speed = 0, firstTextAt = 0, started = false;
    const startedAt = performance.now();
    const longPrompt = ("The quick brown fox jumps over the lazy dog near the"
        + " river bank while the sun sets behind the distant mountains. ")
        .repeat(Number(query.get("repeat") || 40));
    const messages = only == "text"
        ? [
            { role: LlmRole.system, content: "Answer in one short sentence." },
            { role: LlmRole.user, content: "What is the capital of France?" },
        ]
        : only == "long"
        ? [
            { role: LlmRole.system, content: "Answer in one short sentence." },
            { role: LlmRole.user, content: longPrompt + " What is the capital of France?" },
        ]
        : [
            { role: LlmRole.system, content: imageSystem },
            { role: LlmRole.user, content: imageNote, images: [image] },
        ];
    const describe = new Promise(resolve => {
        let settled = false;
        const finish = extra => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(extra || {});
        };
        const timer = setTimeout(() => finish({ timedOut: true }), ${TIMEOUT_MS - 60000});
        createChat({
            model,
            logging: true,
            reasoning: false,
            ...(threads ? { limits: { maxThreads: threads, maxReplyTokens: reply } } : {}),
            messages,
            onResponse: value => {
                if (!firstTextAt) {
                    firstTextAt = performance.now();
                    write("first text " + Math.round(firstTextAt - startedAt) + " ms");
                }
                chunks += 1;
                text = value;
            },
            onSpeed: value => { speed = value; },
            onStatus: snapshot => {
                if (snapshot.requesting) started = true;
                const ended = started
                    ? !snapshot.requesting
                    : !!snapshot.error;
                if (snapshot.error) write("status error " + snapshot.error);
                if (ended) finish({ error: snapshot.error });
            },
        });
    });
    const outcome = await describe;
    const totalMs = Math.round(performance.now() - startedAt);
    write("total " + totalMs + " ms, tokens " + chunks + ", chars " + text.length);
    record("describe", !!text && !outcome.error && !outcome.timedOut, {
        totalMs,
        loadMs,
        firstTextMs: firstTextAt ? Math.round(firstTextAt - startedAt) : undefined,
        tokens: chunks,
        tokensPerSecond: speed,
        chars: text.length,
        timedOut: !!outcome.timedOut,
        error: outcome.error,
        text,
        startedAt: Date.now() - totalMs,
        endedAt: Date.now(),
    });
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
        res.writeHead(200, {
            "content-type": MIME[path.extname(file)] || "application/octet-stream",
            "content-length": `${size}`,
            "cross-origin-opener-policy": "same-origin",
            "cross-origin-embedder-policy": "require-corp",
            "cache-control": "no-store",
        });
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

// /proc sampling: utime + stime per process, tree and renderer only
const statOf = pid => {
    try {
        const
            raw = fs.readFileSync(`/proc/${pid}/stat`, "utf8"),
            rest = raw.slice(raw.lastIndexOf(")") + 2).split(" "),
            ticks = Number(rest[11]) + Number(rest[12]);
        return {
            pid,
            ppid: Number(rest[1]),
            ticks,
            renderer: fs.readFileSync(`/proc/${pid}/cmdline`, "utf8")
                .includes("--type=renderer"),
        };
    } catch { return undefined; }
};
const sample = root => {
    const all = fs.readdirSync("/proc").filter(name => /^\d+$/.test(name));
    const rows = all.map(pid => statOf(Number(pid))).filter(Boolean);
    const tree = new Set([root]);
    let grew = true;
    while (grew) {
        grew = false;
        for (const row of rows)
            if (tree.has(row.ppid) && !tree.has(row.pid)) {
                tree.add(row.pid);
                grew = true;
            }
    }
    let total = 0, renderer = 0, rendererPid = 0, rendererTicks = 0;
    for (const row of rows) {
        if (tree.has(row.pid)) total += row.ticks;
        if (row.renderer && tree.has(row.pid)) {
            renderer += row.ticks;
            if (row.ticks > rendererTicks) {
                rendererTicks = row.ticks;
                rendererPid = row.pid;
            }
        }
    }
    return { at: Date.now(), total, renderer, rendererPid };
};
const threadNames = pid => {
    try {
        return fs.readdirSync(`/proc/${pid}/task`)
            .map(task => {
                try {
                    return fs.readFileSync(`/proc/${pid}/task/${task}/comm`, "utf8").trim();
                } catch { return ""; }
            })
            .filter(Boolean);
    } catch { return []; }
};
const coresOver = (samples, field, from, to) => {
    const window = samples.filter(item => item.at >= from && item.at <= to);
    if (window.length < 2) return { average: 0, peak: 0 };
    const
        first = window[0],
        last = window[window.length - 1],
        seconds = (last.at - first.at) / 1000,
        average = seconds > 0
            ? (last[field] - first[field]) / HZ / seconds
            : 0;
    let peak = 0;
    for (let index = 1; index < window.length; index++) {
        const
            before = window[index - 1],
            after = window[index],
            span = (after.at - before.at) / 1000,
            rate = span > 0 ? (after[field] - before[field]) / HZ / span : 0;
        if (rate > peak) peak = rate;
    }
    return { average, peak };
};

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
        ...(process.env.BENCH_GPU
            ? [
                "--enable-unsafe-webgpu",
                "--enable-features=Vulkan,WebGPU",
                "--use-angle=vulkan",
            ]
            : ["--disable-gpu"]),
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
        samples = [],
        logs = [],
        sampler = setInterval(() => {
            try { samples.push(sample(chrome.pid)); } catch { }
        }, 200),
        ws = new WebSocket(target.webSocketDebuggerUrl);
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
    await send("Page.navigate", {
        url: `http://127.0.0.1:${PORT}/index.html?threads=${THREADS}`
            + `&reply=${REPLY}&model=${MODEL}&image=${encodeURIComponent(IMAGE)}`
            + `&label=${encodeURIComponent(LABEL)}`
            + (ONLY ? `&only=${ONLY}` : ""),
    });

    const
        started = Date.now(),
        poll = async () => {
            const result = await send("Runtime.evaluate", {
                expression: "document.getElementById('results')?.textContent ?? 'running'",
                returnByValue: true,
                awaitPromise: true,
            });
            return result?.result?.value || "running";
        };
    let text = "running", timedOut = false;
    while (Date.now() - started < TIMEOUT_MS) {
        text = await poll();
        if (text.includes('"done":true') || text.includes("fatal")
            || text.includes('"ok":false')) break;
        await sleep(500);
    }
    if (!text.includes('"done":true')) timedOut = true;
    clearInterval(sampler);

    const logText = await send("Runtime.evaluate", {
        expression: "document.getElementById('log')?.textContent ?? ''",
        returnByValue: true,
    });
    const pageLog = logText?.result?.value || "";
    let report;
    try { report = JSON.parse(text); } catch { report = { steps: [], fatal: text }; }

    const
        describe = report.steps?.find(step => step.name == "describe")?.detail,
        load = report.steps?.find(step => step.name == "load")?.detail,
        capabilities = report.steps?.find(step => step.name == "capabilities")?.detail,
        from = describe?.startedAt ?? 0,
        to = describe?.endedAt ?? 0,
        all = coresOver(samples, "total", from, to),
        tab = coresOver(samples, "renderer", from, to),
        rendererPid = samples
            .filter(item => item.at >= from && item.at <= to)
            .map(item => item.rendererPid)
            .filter(Boolean)
            .pop(),
        threadsSeen = rendererPid ? threadNames(rendererPid) : [],
        diagnostic = pageLog.split("\n")
            .filter(line => line.includes("CPU engine ready")).pop(),
        timeline = (() => {
            const
                window = samples.filter(item =>
                    !from || (item.at >= from && item.at <= to)),
                out = [];
            let last;
            for (const item of window) {
                if (last && item.at - last.at < 1000) continue;
                if (last) {
                    const
                        span = (item.at - last.at) / 1000,
                        cores = (item.renderer - last.renderer) / HZ / span;
                    out.push({
                        second: Math.round((item.at - (from || item.at)) / 1000),
                        cores: +cores.toFixed(2),
                    });
                }
                last = item;
            }
            return out;
        })(),
        result = {
            label: LABEL,
            mode: ONLY || "image",
            threads: THREADS,
            reply: REPLY,
            model: MODEL,
            image: IMAGE,
            cores: capabilities?.cores,
            isolated: capabilities?.crossOriginIsolated,
            loaded: !!load,
            loadMs: load?.loadMs,
            totalMs: describe?.totalMs,
            firstTextMs: describe?.firstTextMs,
            tokens: describe?.tokens,
            tokensPerSecond: describe?.tokensPerSecond,
            chars: describe?.chars,
            text: describe?.text,
            timedOut: timedOut || !!describe?.timedOut,
            error: describe?.error,
            cpu: {
                allCores: +all.average.toFixed(2),
                allPercent: +((all.average / (capabilities?.cores || 8)) * 100).toFixed(1),
                allPeakCores: +all.peak.toFixed(2),
                tabCores: +tab.average.toFixed(2),
                tabPercent: +((tab.average / (capabilities?.cores || 8)) * 100).toFixed(1),
                tabPeakCores: +tab.peak.toFixed(2),
                samples: samples.filter(item => item.at >= from && item.at <= to).length,
            },
            osThreads: threadsSeen.length,
            threadNames: threadsSeen,
            diagnostic,
            timeline,
            logTail: pageLog.split("\n").slice(-40),
        };
    fs.writeFileSync(
        path.join(ROOT, "build", `cpu-bench-${LABEL}.json`),
        JSON.stringify(result, null, 2),
    );
    fs.writeFileSync(
        path.join(ROOT, "build", `cpu-bench-${LABEL}.log`),
        pageLog,
    );
    console.log("---- results ----");
    console.log(JSON.stringify(result, null, 2));
    ws.close();
    chrome.kill();
    server.close();
    process.exit(result.timedOut || result.error ? 1 : 0);
};

main().catch(error => {
    console.error(error);
    process.exit(3);
});
