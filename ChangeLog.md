# Changelog

## 0.7.1

- Add `ChatModelId.gemma4_e2b_limited`, the text-only build a phone or tablet
  loads for a Gemma request.
- Add `ChatStatusSnapshot.model`, the build that actually runs after the mobile
  swap.

## 0.7.0

- Add `builtinTools`, which builds the `websearch`, `calculate` and `currency`
  tools on request. The host runs a tool through `ChatTool.execute`; the model
  is never offered tools.
- Add `calculateTool`, `currencyTool` and `webSearchTool`, the three built-in
  tool descriptors.
- Add `BuiltinTool` and `WebSearchProvider`, the built-in tool ids and the
  search provider ids.
- Add `ChatTool`, `ChatToolCall`, `ChatToolResult`, `ChatToolSchema`,
  `ChatToolValue`, `WebSearchConfig` and `WebSearchResult`, the shape of one
  tool, its call, its result and the search settings.

## 0.4.0

- Add `ChatMessage.audio`, a list of audio data URLs or URLs attached to a user
  turn.
- Add `LlmLimits.maxAudio`, the number of audio clips kept in one prompt,
  default 1.
- Add `ChatStatusSnapshot.supportsAudio`, whether the requested model accepts
  audio.
- Gemma 4 E2B accepts WAV, MP3 and FLAC on the WebGPU engine; Qwen3-VL 2B does
  not accept audio on the CPU engine.

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
