// Headless Chromium test driver.
// Usage: node test/drive.cjs <distDir> [port] [debugPort] [profile]
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const ROOT = path.resolve(process.argv[2] || "build");
const PORT = Number(process.argv[3] || 17544);
const DEBUG_PORT = Number(process.argv[4] || 9334);
const PROFILE =
    process.argv[5] || `${os.homedir()}/snap/chromium/common/ds_chat_chrome`;
const TIMEOUT_MS = Number(process.argv[6] || 60000);

const PAGE = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>verify</title></head>
  <body>
    <pre id="results">running</pre>
    <script>
      window.addEventListener("error", (event) => {
        const out = document.getElementById("results");
        if (out && out.textContent === "running") {
          out.textContent = "ERROR: " + (event.error && event.error.stack
            ? event.error.stack
            : event.message);
        }
      });
      window.addEventListener("unhandledrejection", (event) => {
        const out = document.getElementById("results");
        if (out && out.textContent === "running") {
          out.textContent = "REJECTION: " + (event.reason && event.reason.stack
            ? event.reason.stack
            : String(event.reason));
        }
      });
    </script>
    <script src="harness.js"></script>
  </body>
</html>
`;

const MIME = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".wav": "audio/wav",
    ".bin": "application/octet-stream",
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getJson = (url) =>
    new Promise((resolve, reject) => {
        http
            .get(url, (res) => {
                let data = "";
                res.on("data", (chunk) => (data += chunk));
                res.on("end", () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (error) {
                        reject(error);
                    }
                });
            })
            .on("error", reject);
    });

const serve = () =>
    new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            const url = decodeURIComponent((req.url || "/").split("?")[0]);
            const file = path.join(ROOT, url.replace(/^\/+/, ""));
            if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
                res.writeHead(404);
                res.end("not found");
                return;
            }
            res.writeHead(200, {
                "content-type": MIME[path.extname(file)] || "application/octet-stream",
                "cross-origin-opener-policy": "same-origin",
                "cross-origin-embedder-policy": "require-corp",
            });
            fs.createReadStream(file).pipe(res);
        });
        server.listen(PORT, "127.0.0.1", () => resolve(server));
        server.on("error", (error) => {
            console.error("server error", error.message);
            process.exit(4);
        });
    });

const main = async () => {
    fs.mkdirSync(ROOT, { recursive: true });
    fs.writeFileSync(path.join(ROOT, "index.html"), PAGE);
    fs.rmSync(PROFILE, { recursive: true, force: true });
    fs.mkdirSync(PROFILE, { recursive: true });

    const server = await serve();
    const pageUrl = `http://127.0.0.1:${PORT}/index.html`;
    const chrome = spawn(
        "chromium",
        [
            "--headless=new",
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required",
            `--remote-debugging-port=${DEBUG_PORT}`,
            `--user-data-dir=${PROFILE}`,
            "about:blank",
        ],
        { stdio: ["ignore", "ignore", "ignore"] },
    );

    let target = null;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !target) {
        try {
            const list = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json/list`);
            target = list.find((entry) => entry.type === "page");
        } catch {
            // browser not up yet
        }
        if (!target) {
            await sleep(300);
        }
    }
    if (!target) {
        console.error("chromium did not expose a page target");
        chrome.kill();
        server.close();
        process.exit(2);
    }

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    let id = 0;
    const pending = new Map();
    const logs = [];
    ws.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg.result);
            pending.delete(msg.id);
            return;
        }
        if (msg.method === "Runtime.consoleAPICalled") {
            logs.push((msg.params.args || []).map((a) => a.value ?? a.description ?? "").join(" "));
        }
    });
    const send = (method, params = {}) =>
        new Promise((resolve) => {
            const msgId = ++id;
            pending.set(msgId, resolve);
            ws.send(JSON.stringify({ id: msgId, method, params }));
        });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("ws open timeout")), 10000);
        ws.addEventListener("open", () => {
            clearTimeout(timer);
            resolve();
        });
    });
    await send("Runtime.enable");
    await send("Page.enable");
    await send("Page.navigate", { url: pageUrl });

    const evaluate = async (expression) => {
        const result = await send("Runtime.evaluate", {
            expression,
            returnByValue: true,
            awaitPromise: true,
        });
        return result?.result?.value;
    };

    const start = Date.now();
    let text = "running";
    while (Date.now() - start < TIMEOUT_MS) {
        text = await evaluate("document.getElementById('results')?.textContent ?? 'running'");
        if (text && text !== "running") {
            break;
        }
        await sleep(500);
    }

    console.log(logs.join("\n"));
    console.log("---- results ----");
    console.log(text);

    ws.close();
    chrome.kill();
    server.close();
    process.exit(text && text.includes('"fail": 0') ? 0 : 1);
};

main().catch((error) => {
    console.error(error);
    process.exit(3);
});
