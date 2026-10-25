# Changelog

## 0.1.0

- Replace the facade with one-shot `createChat` calls that return a cancel
  function.
- Add `ChatInput` for one request and `ChatStatusSnapshot` for its status.
- Stream accumulated reasoning and reply text through callbacks.
- Keep the loaded model between calls and free it when a cancel arrives.
- Add `LlmLimits` for token, prompt and history budgets.
- Bundle the WebLLM and wllama engines into the browser and Node builds.
- Start every engine through the unified `startLLM` runtime contract.
