# Changelog

## 0.6.0

- Add `ChatTool`, `ChatToolCall`, `ChatToolResult`, `ChatToolSchema` and
  `ChatToolValue`, the shape of one tool the model may call.
- Add `ChatInput.tools`, `onToolCall`, `onToolResult` and `maxToolRounds` so a
  host can offer its own tools in the same reply.
- Add `ChatInput.builtins`, `ChatInput.websearch`, the `BuiltinTool` and
  `WebSearchProvider` enums, `WebSearchConfig` and `WebSearchResult`, for the
  built-in `websearch`, `calculate` and `currency` tools.
- Add `ChatStatusSnapshot.supportsTools`, whether the requested model accepts
  tool declarations.
- Gemma 4 E2B calls tools on the WebGPU engine; Qwen3-VL 2B and the CPU engine
  report `supportsTools: false`.

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
