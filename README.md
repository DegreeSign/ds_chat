# @degreesign/chat

Plug-and-play on-device AI chat for browsers, workers and Node: one model in
memory, unlimited offline replies in any UI. The package picks the engine,
manages the download, fits the prompt and reuses the cache; a wllama CPU engine
and a LiteRT-LM WebGPU engine run it all locally, and every export is typed.

[![npm version](https://img.shields.io/npm/v/@degreesign/chat.svg)](https://www.npmjs.com/package/@degreesign/chat)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#licensing)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](#faq)
[![types](https://img.shields.io/badge/types-included-brightgreen.svg)](#faq)
[![architecture](https://img.shields.io/badge/architecture-view-blue.svg)](https://degreesign.github.io/ds_chat/architecture.html)
[![comparison](https://img.shields.io/badge/comparison-web--llm-blue.svg)](https://degreesign.github.io/ds_chat/vs_web_llm.html)

## Demo

[Open the showcase](https://degreesign.github.io/ds_chat/) for a live chat demo
in the browser, or browse the [architecture
map](https://degreesign.github.io/ds_chat/architecture.html). The demo downloads
a model once, about 1.5 GB on the CPU engine or 2.0 GB on WebGPU, and then
answers on the device.

**[Open the live showcase →](https://degreesign.github.io/ds_chat/)**

## Table of contents

- [Demo](#demo)
- [Why](#why)
- [Install](#install) 
- [Quick start](#quick-start) 
- [Public API](#public-api) 
- [Tools](#tools) 
- [Status](#status) 
- [Models](#models) 
- [Prompt assembly](#prompt-assembly) 
- [Enable WebGPU](#enable-webgpu) 
- [Engines and assets](#engines-and-assets) 
- [Node.js](#nodejs) 
- [React](#react) 
- [Types](#types) 
- [Testing](#testing) 
- [Architecture](#architecture) 
- [FAQ](#faq) 
- [Licensing](#licensing)

## Why

- Proven: [DoListy](https://dolisty.com/#chat), a no-signup PWA, describes
  photos, turns voice notes into tasks with `@degreesign/voice`, and answers
  with the network off.
- On device: weights download once, then every reply is generated locally,
  with no API key and no per-reply cost.
- Plug and play: the package picks the engine, fits the prompt, resumes the
  download and reuses the cache, with no setup.
- Headless and stateless: results arrive through callbacks, so any UI can
  render them, and no history is kept; the host passes the whole message list.
- Two engines behind one runtime: CPU through wllama, WebGPU through LiteRT-LM.
- Typed and portable: declarations for every export, and importing it works in
  browsers, workers, React and Node.

## Install

```bash
npm install @degreesign/chat
yarn add @degreesign/chat
pnpm add @degreesign/chat
```

The engines and helpers are bundled into dynamic chunks, so a host resolves no
engine import and downloads only the chunk a model uses. Only the model weights
come from outside the package. The build emits `dist/browser/chat.min.mjs` with
its engine chunks, the CommonJS and ESM Node entries in `dist/node/`, the wasm
assets in `dist/assets/wllama/` and `dist/assets/litert/`, and `dist/index.d.ts`.

Build with `yarn build`, typecheck with `yarn typecheck` and test the Node entry
with `yarn verify:node`.

## Quick start

Build the full prompt, call `createChat`, and render the accumulated text. The
call returns one cancel function and starts the model behind the status
callback.

```ts
import { LlmRole, clearModelCache, createChat, preloadModel } from "@degreesign/chat";

const messages = [
  { role: LlmRole.system, content: "Answer in two sentences." },
  { role: LlmRole.user, content: "Hello" },
];

// Optional: download and load the model before the first send.
await preloadModel();

const cancel = createChat({
  messages,
  onResponse: (text) => renderReply(text),
  // onThinking, onSpeed, onPromptSpeed and onStatus are optional.
});

// Later, stop the reply, cancel the load, or free the model.
cancel();
// Delete every cached model file when the device needs the space.
await clearModelCache();
```

Without `model` the package picks the GPU model when the browser provides a
WebGPU adapter and the CPU model when it does not.

`createChat` returns no promise and no controller. Every result arrives through
`onResponse`, and `onStatus` reports `requesting: false` when the reply ends.
`onSpeed` measures from the first token, so it excludes prompt processing. The
host appends the user and assistant messages itself; the package never writes
storage. A user turn may carry `images` or `audio`; see
[Prompt assembly](#prompt-assembly).

## Public API

```ts
createChat(input: ChatInput): CancelChat
preloadModel(input?: ChatPreloadInput): Promise<boolean>
describeImage(input: DescribeImageInput): Promise<string>
descriptionEnhanced(input: DescriptionEnhancedInput): Promise<DescriptionEnhanced>
translateTags(input: TranslateTagsInput): Promise<ImageTag[]>
describeModelId: ChatModelId
imageReplyTokens: number
gpuAdapter(): Promise<boolean>
clearModelCache(): Promise<void>
```

Call it once per response. A new call aborts the previous stream, and a model
already loaded skips the download and the load. One model stays resident, and
`clearModelCache` releases it and deletes every cached file.

`ChatInput`:

| Field | Description |
| ----- | ----------- |
| `model?` | `ChatModelId` to use; a different model replaces the loaded one. |
| `messages` | The complete prompt, including system messages and the new user turn. |
| `limits?` | Partial `LlmLimits`; see the budget defaults below. |
| `reasoning?` | Whether the model may think first. Defaults to `false`. |
| `logging?` | Whether package and engine console logs are written. Defaults to `false`. |
| `onThinking?` | Receives the accumulated reasoning text as it streams. |
| `onResponse` | Receives the accumulated reply text as it streams. Required. |
| `onSpeed?` | Receives the current generation speed in tokens per second. |
| `onPromptSpeed?` | Receives live prompt processing speed in tokens per second. |
| `onStatus?` | Receives a `ChatStatusSnapshot` on every state change. |

The budget defaults are 250 reply tokens, 128 CPU thinking tokens, 1200 GPU
reasoning tokens (320 on the CPU), 2 images, 1 audio clip, 1000 characters per
message, 10000 prompt characters, 32 CPU threads and a full GPU busy share. The
CPU engine ignores `gpuShare`; the GPU engine applies it after prefill.

`CancelChat` is `() => void`:

| State | Effect |
| ----- | ------ |
| Downloading or loading | Stops waiting; a shared download keeps going and its bytes stay. |
| Ready | Aborts the reply and unloads the model that answered. |
| An older call | Nothing, because a newer call owns the runtime. |

### Preload

Call `preloadModel` before the first `createChat` to load early. It resolves
`true` when the runtime is ready and `false` when the model is unknown,
unsupported or failed. A preload owns no cancel function, so a cancelled chat
leaves its download running.

`ChatPreloadInput` takes `model?`, `limits?`, `logging?` and `onStatus?`. The
final snapshot reports `ready: true`, `phase: LlmPhase.load` and `percent: 100`
on success, or an `error` with `availability: ChatStatus.offline` on failure.

### Describe one image

```ts
describeImage(input: DescribeImageInput): Promise<string>
```

Describe one image in English with `qwen3_vl_2b_instruct`, the Q4_K_M build of
Unsloth Qwen3-VL 2B Instruct. The describer replaces euphemisms with specific
terms, names visible organs and limbs for living things, and prioritizes
unusual details. It must never lie, use vague referrals, prefer a
general term over a precise one, or repeat the request.
`systemRulesOverride` replaces the default system message. The call uses the
`imageReplyTokens` budget of 128 tokens unless `limits.maxReplyTokens`
overrides it, requests 192 vision tokens for its resize, and samples at
temperature 0.1.

`DescribeImageInput` extends `CallOptions`:

| Field | Description |
| ----- | ----------- |
| `image` | One image data URL or URL. |
| `systemRulesOverride?` | Replaces the default describer system message. |
| `onSpeed?` | Receives the generation speed, tokens per second. |
| `onText?` | Receives the accumulated streamed text. |

The promise resolves the trimmed English description, or an empty string when
the model returns no text. A finished load reports `percent: 100` and
`phase: LlmPhase.load` before the first text, so a host can clear its progress
row.

### Enhance a description

```ts
descriptionEnhanced(
    input: DescriptionEnhancedInput,
): Promise<DescriptionEnhanced>
```

Take one English description, translate it when the target is not English, then
build its gallery tags from the same text. Without a `model` override, the text
model is `gemma4_e2b_limited` when a WebGPU adapter exists and `qwen3_vl_2b`
otherwise. The tag pass asks for three English words, then fills the target
language key of each tag. A failed translation, or the reply
`CANNOT_TRANSLATE`, keeps the English description. A failed tag call leaves the
tags empty; a missing tag translation keeps the English tag.

`DescriptionEnhancedInput` extends `CallOptions`:

| Field | Description |
| ----- | ----------- |
| `descriptionEN` | The English description to translate and tag. |
| `targetLanguage` | Language name used in the prompts, such as `German`. |
| `targetCode` | Two-letter code used as the tag translation key, such as `de`. |
| `withTags?` | Whether tags are generated. Defaults to `true`. |
| `withDescription?` | Whether the description is translated. Defaults to `true`. |
| `model?` | Text model override; the package picks the GPU build when available. |
| `onStage?` | Receives `translate`, `tags` or `translateTags` as each pass starts. |
| `onSpeed?` | Receives the generation speed, tokens per second. |
| `onText?` | Receives the accumulated streamed text and its stage. |

`DescriptionEnhanced` holds `description` (the translation or English
fallback), `translated` (whether the target language is in use), `tags` (up to
three, with `en` and the target code, including `nsfw` when flagged) and
`nsfw?` boolean.

### Translate stored tags

```ts
translateTags(input: TranslateTagsInput): Promise<ImageTag[]>
```

Translate tags a gallery already holds, without describing or tagging again.
Each tag keeps its `en` word and gains the `targetCode` key; a refusal or a
failed call returns the English tags unchanged. The text model follows the same
rule as `descriptionEnhanced`, and it is reused when it already sits in memory.

`TranslateTagsInput` extends `CallOptions`:

| Field | Description |
| ----- | ----------- |
| `tags` | The `ImageTag` list to translate. |
| `targetLanguage` | Language name used in the prompt, such as `German`. |
| `targetCode` | Two-letter code written as the tag translation key. |
| `model?` | Text model override; the package picks the GPU build when available. |
| `onText?` | Receives the accumulated streamed text. |

### Call options

Every description and tag call takes the same `CallOptions`:

| Field | Description |
| ----- | ----------- |
| `signal?` | Stops the call and leaves finished work in place. |
| `limits?` | Partial `LlmLimits` for every model call of the request. |
| `logging?` | Whether package and engine console logs are written. Defaults to `false`. |
| `onStatus?` | Receives a `ChatStatusSnapshot` while the model loads and runs. |
| `onEstimate?` | Receives an `EstimateReport` before the model loads. |

### Estimates

The three functions report stage durations through `onEstimate`, with `totalEst` and
a `breakdown` of `operation` and `est` seconds. `describeImage` reports
`analyze` and `describe`; `descriptionEnhanced` reports `translate`, `tags` and
`translateTags`; `translateTags` reports `translateTags` alone, leaving out a
stage that will not run. Measured stages are kept under the `localStorage` key
`degreesign-chat-estimates-v1`, with a built-in fallback until then.

### Deprecated batch helpers

`describeImages` and `describeTranslated` remain as wrappers over the two
single-item functions. They are deprecated, will be removed after November 2027,
and skip translation when no WebGPU adapter exists. Use `describeImage` and
`descriptionEnhanced` for new code.

## Tools

Three built-in tools ship as descriptors. They are not connected to the model:
the package never declares a tool to an engine and never runs one by itself.

```ts
import { builtinTools, BuiltinTool } from '@degreesign/chat';

const [calculation] = builtinTools([BuiltinTool.calculate]);
const answer = await calculation.execute({ expression: `6*7` });
```

| Export | Description |
| ------ | ----------- |
| `builtinTools(names, config?)` | Returns the requested tools in the order given. |
| `calculateTool` | Evaluates an arithmetic expression, fully local. |
| `currencyTool` | Converts between fiat, metals and coins through the CoinExams feed. |
| `webSearchTool(config?)` | Searches Wikipedia by default, or DuckDuckGo. |
| `BuiltinTool` | `websearch`, `calculate` or `currency`. |
| `WebSearchProvider` | `wikipedia` or `duckduckgo`. |

Each tool has `name`, `description`, `parameters` (`ChatToolSchema`) and
`execute(args)`, which returns a JSON-safe `ChatToolValue` or throws.
`webSearchTool` takes `provider`, a Wikipedia `language`, `limit`,
`snippetLength` and `timeout`. Search and currency fetch over the network;
`calculate` does not.

## Status

`ChatStatusSnapshot` is the only lifecycle signal:

| Field | Description |
| ----- | ----------- |
| `model?` | The model that runs, or the requested build before it resolves. |
| `availability` | `ChatStatus.online`, `.away` or `.offline`, derived from `status`. |
| `status` | `LlmStatus`: `idle`, `downloading`, `ready`, `error` or `unsupported`. |
| `backend` | `LlmBackend.cpu`, `.gpu` or `.none`. |
| `supportsImages` | Whether the model accepts images on this device. |
| `supportsAudio` | Whether the model accepts audio on this device. |
| `ready` | Whether a model is loaded and accepts a reply. |
| `loading` | Whether a download or load is in flight. |
| `requesting` | Whether a reply is streaming right now. |
| `phase` | `LlmPhase.download` or `.load`. |
| `percent` | Download or load progress, `0` to `100`. |
| `error?` | The last failure, cleared when a reply starts. |

The first snapshot fires synchronously inside `createChat`. A final snapshot
with `requesting: false` marks the end, including a cancelled call.
`describeImage` and `descriptionEnhanced` report the same snapshots.

A stream that never produces its first chunk ends after 5 minutes on a desktop
or 50 minutes on a phone, and an image turn waits at least 14 minutes for a
slow CPU prefill. Once a chunk arrives, 30 seconds of silence ends the stream
and keeps the text already delivered. Console output stays off unless a call
passes `logging: true`.

## Models

| `ChatModelId` | Name | Reasoning | Images | Audio | CPU | WebGPU |
| ------------- | ---- | --------- | ------ | ----- | --- | ------ |
| `qwen3_vl_2b` | Qwen3-VL 2B | Yes | Yes | No | Yes | No |
| `qwen3_vl_2b_instruct` | Qwen3-VL 2B Instruct | No | Yes | No | Yes | No |
| `qwen3_vl_2b_instruct_q3` | Qwen3-VL 2B Instruct Q3 | No | Yes | No | Yes | No |
| `gemma4_e2b_limited` | Gemma 4 E2B limited | Yes | No | No | No | Yes |

`qwen3_vl_2b` is the general and vision model: a 445 MB projector with the
model, about 1.5 GB in total, and a 4096 token context on a phone or 8192 on a
desktop. Its projector shares the text thread budget, so image turns wait.

`qwen3_vl_2b_instruct` is the Unsloth Q4_K_M build that `describeImage` loads,
with the same Q8_0 projector and no reasoning pass; the Q3_K_M variant is about
160 MB smaller.

`gemma4_e2b_limited` loads the 2.0 GB `gemma-4-E2B-it-gpu.litertlm` with a
32768 token context on a desktop and 16384 on a phone, without vision or audio
encoders. A first call downloads it and later calls reuse it; an interrupted
download resumes from the last committed part.

## Prompt assembly

The `messages` array is the whole prompt. The package bounds it and shapes it
for the engine; it adds no identity, language or task text of its own.

```text
system:    {system messages, in list order}
user:      {first user turn}
assistant: {next turn}
user:      {next turn}
```

- Leading assistant turns are dropped, consecutive same-role turns are merged,
  and empty messages are skipped.
- `maxContentLength` clips each message and `promptCharBudget` bounds the whole
  prompt; image and audio payloads do not count against it.
- Every prompt is fitted to the model context window: oldest non-system turns
  are dropped until the prompt and a 64-token reply fit, and the reply budget
  is capped to the remaining window with 128 tokens reserved for the template.
- System messages are folded into one leading system turn.
- Images and audio come from the newest turns first, capped by `maxImages`
  (default 2) and `maxAudio` (default 1). Older parts are dropped, text stays.
- Each image keeps its full frame and targets 128 vision tokens, at most 136,
  snapped to multiples of 32 px with the remainder cropped.
- An image-only turn with a text model reports `Model does not accept images`;
  an audio-only turn reports `Model does not accept audio`.

## Enable WebGPU

A request without `model` picks `gemma4_e2b_limited` when the browser exposes a
WebGPU adapter and `qwen3_vl_2b` when it does not. `gpuAdapter()` runs the same
probe, and every snapshot reports the running build in `model`. Check before
blaming the package:

```js
const adapter = await navigator.gpu?.requestAdapter();
adapter
    ? `${adapter.info.vendor} ${adapter.info.architecture}`
    : `no adapter`;
```

`null` means the API exists but no adapter does. Chromium reports the state at
`chrome://gpu`: `WebGPU` should read `Hardware accelerated`. Firefox lists
features at `about:support`, and on Linux needs `dom.webgpu.enabled` set to
`true` in `about:config`.

Chrome, Edge and Brave ship WebGPU on Windows, macOS and ChromeOS. On Linux,
start the browser with both flags, since either one alone returns `null`:

```bash
google-chrome --enable-features=Vulkan --use-angle=vulkan
```

`--enable-unsafe-webgpu` only unlocks software adapters: a vendor that reads
`google` is SwiftShader on the CPU. Headless Chromium needs it plus
`--enable-features=Vulkan,WebGPU` and `--use-angle=vulkan`.

The GPU engine keeps the model and KV cache in GPU memory and rests after every
token readback only when `limits.gpuShare` asks for it. The default is `1`, no
rest, so the card sits at the full decode rate; lower it, from 0.05 to 1, to
leave the card time between tokens, and prefill always runs unpaced. A busy card
can lose the device (`VK_ERROR_DEVICE_LOST`); close other GPU tabs or use the
CPU model.

## Engines and assets

The engine is chosen per model: WebGPU through LiteRT-LM when the model has a
`litert` artifact and the browser exposes `navigator.gpu` and `WebAssembly`;
CPU through wllama when the model has a `cpu` artifact; `LlmStatus.unsupported`
otherwise, including Node. Both implement `startLLM` and return `model`,
`backend`, `contextSize`, `chat()` and `unload()`.

The CPU engine keeps a fifth of the logical cores free (at least one) and gives
the rest to the engine, so 8 threads run with 7. `limits.maxThreads` only
lowers the count. The vision path runs two ggml pools, sized by
`scripts/patch-wllama.cjs` on every build.

The CPU engine needs cross-origin isolation for its threads:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Assert `crossOriginIsolated === true` in the page; without isolation the engine
falls back to one thread. Under `require-corp` every cross-origin subresource
must be CORS enabled or carry `Cross-Origin-Resource-Policy`.

Both engines keep resumable parts in the origin private file system, under
`wllama-store` and `litert-store`. Downloads fetch 32 MB ranges and resume from
the last committed byte.

The package ships the wllama binaries under `dist/assets/wllama` and the LiteRT
wasm under `dist/assets/litert`. Copy both folders next to the app bundle in
production; wllama needs its compat worker on the same origin. LiteRT-LM needs
WebGPU with the JSPI and relaxed SIMD wasm features.

## Node.js

The package imports and runs without a DOM, so it works in scripts, tests, SSR
and server side orchestration with prompt assembly, budgets, status and
cancellation. Both engines need a browser, so `createChat` there reports
`LlmStatus.unsupported` and `ChatStatus.offline`, the callbacks stay silent, and
`preloadModel` resolves `false`.

```js
const { createChat, preloadModel, ChatModelId, LlmRole } = require("@degreesign/chat");
```

```js
import { createChat, preloadModel, ChatModelId, LlmRole } from "@degreesign/chat";
```

`require` resolves `dist/node/chat.node.min.js` and `import` resolves
`dist/node/chat.node.min.mjs`, both through the exports map.

## React

Call `createChat` from the send handler, keep the cancel function in a ref, and
unmount it with the panel. The package never touches the DOM, so the same
module renders during SSR.

```tsx
import { useEffect, useRef, useState } from "react";
import { ChatModelId, LlmRole, createChat } from "@degreesign/chat";

const useReply = () => {
  const cancelRef = useRef<(() => void) | null>(null);
  const [reply, setReply] = useState("");

  useEffect(() => () => cancelRef.current?.(), []);

  const send = (history, text) => {
    setReply("");
    cancelRef.current = createChat({
      model: ChatModelId.qwen3_vl_2b,
      messages: [...history, { role: LlmRole.user, content: text }],
      onResponse: setReply,
    });
  };

  return { reply, send };
};
```

## Types

The inputs are `ChatInput`, `ChatPreloadInput`, `DescribeImageInput`,
`DescriptionEnhancedInput` and `TranslateTagsInput`, every image and tag input
built on `CallOptions`; the results are `DescriptionEnhanced`, `EstimateReport`
and `ImageTag`. `ChatMessage`, `ChatStatusSnapshot`, `LlmLimits`, `CancelChat`
and `WllamaAssets` describe the rest; the deprecated types are
`DescribeImagesInput`, `DescribeTranslatedInput` and `ImageDescription`. The
enums are `ChatModelId`, `LlmRole`, `ChatStatus`, `LlmStatus`, `LlmBackend`,
`LlmPhase`, `EstimateOperation`, `DescriptionEnhancedStage` and
`ChatPreloadField`.

## Testing

`yarn test:instruct` starts a local llama.cpp server with the Qwen3-VL 2B
Instruct Q4_K_M build on `127.0.0.1:8080`, CPU only, caching the weights outside
the repository. `yarn test:images` runs the browser suite against it, and the
fake-engine harness needs no server. `yarn verify:node` checks the Node entry.

## Architecture

The [interactive map](https://degreesign.github.io/ds_chat/architecture.html)
covers the two entries, every source module with line numbers, the helper edges
and the send flow. A
[comparison with `@mlc-ai/web-llm`](https://degreesign.github.io/ds_chat/vs_web_llm.html)
covers Gemma 4 E2B on WebGPU.

## FAQ

### What is @degreesign/chat?

A headless on-device inference controller. It loads one model, streams one reply
and reports status; the app owns the chat history, storage and UI, passes the
full prompt on every call and keeps the reply.

### Does it support images or audio?

Images work on models with vision support: put URLs in a user turn's `images`
array. A model without vision drops them when the turn also has text, and an
image-only turn reports `Model does not accept images`. No catalog model has an
audio encoder, so `audio` behaves the same way.

### Does it need a server or runtime dependencies?

No. Chat, download and inference run on the device, and the engines ship
bundled, so a host imports no engine and wires no peer dependency.

### Which model should I pick?

Qwen3-VL 2B supports reasoning and images on the CPU, and runs on any browser
with WebAssembly. Gemma 4 E2B supports reasoning on WebGPU with faster text, but
a larger download and a slower first compile.

## Licensing

The runtime code is MIT licensed. The inference engine and model weights are
distributed by their authors under their own terms, listed in
`THIRD_PARTIES.md`. See `LICENSE`.

## Keywords

`@degreesign/chat`, on-device AI chat, local LLM, wllama, litert, webgpu,
gemma, wasm, chat controller, headless chat, TypeScript, browser, speech
friendly replies.
