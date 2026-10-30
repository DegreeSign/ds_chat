# Changelog

## 1.1.0

- Load models on different backends at the same time, so a host can warm the
  GPU text model and the CPU media model with one `Promise.all`. A load on the
  same backend still replaces the one in flight, and a phone still keeps one
  model in total.
- Report the last failure and engine status per model, so a concurrent load
  never reports the outcome of the other one.
- Add `describeModelId`, the model `describeImages` loads for its English pass,
  so a host can warm it beside its own text model.

## 1.0.0

- Add `describeTranslated`, which translates existing English image descriptions
  on the GPU and returns one translated string per description, keeping English
  when the translator is unavailable or declines.
- Add `DescribeTranslatedInput`, the batch translation request.
- Add `ChatModelId.qwen3_vl_2b_instruct_q3`, the Q3_K_M build of Unsloth
  Qwen3-VL 2B Instruct, and make `describeImages` load it for the English
  pass. `qwen3_vl_2b_instruct` stays in the catalog as the Q4_K_M build.

## 0.9.2

- Add `ImageDescription.durationMs`, the time the describer took for one image.
- Pass that duration to `DescribeImagesInput.currentIndex` as its fourth
  argument, so a host can show a per-image timing before the translation
  arrives.

## 0.9.0

- Add `describeImages`, which describes every image in English with
  `qwen3_vl_2b_instruct` and translates each description on a WebGPU device
  with `gemma4_e2b_limited`.
- Add `DescribeImagesInput` and `ImageDescription`, the batch request and one
  English plus translated description.
- Add `ChatModelId.qwen3_vl_2b_instruct`, the Unsloth Qwen3-VL 2B Instruct
  build used by `describeImages`.

## 0.8.0

- Add `clearModelCache`, which releases the loaded model and deletes every
  cached model file.
- Switching models keeps the previous model on disk, so a switch back skips
  the download.

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
