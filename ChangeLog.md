# Changelog

## 0.3.7

- Add `onSpeed` to `ChatInput`, a per-call callback that receives the current
  generation speed in tokens per second, measured from the first streamed
  token so prompt processing is excluded.

## 0.2.0

- Add `preloadModel`, a promise that downloads and loads a model before the
  first `createChat` call, so the first reply starts without a load.
- Add `ChatPreloadInput`, the subset of `ChatInput` that a preload accepts:
  `model`, `limits`, `logging` and `onStatus`.

## 0.1.0

- Replace the facade with one-shot `createChat` calls that return a cancel
  function.
- Add `ChatInput` for one request and `ChatStatusSnapshot` for its status.
- Stream accumulated reasoning and reply text through callbacks.
- Keep the loaded model between calls and free it when a cancel arrives.
- Add `LlmLimits` for token, prompt and history budgets.
- Bundle the WebLLM and wllama engines into the browser and Node builds.
- Start every engine through the unified `startLLM` runtime contract.
