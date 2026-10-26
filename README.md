# @degreesign/chat

One-shot on-device AI chat for browsers, workers and Node, running a wllama CPU
engine or a LiteRT-LM WebGPU engine. The host owns the messages and the UI; the
package loads one model, streams one reply and reports status.

[![npm version](https://img.shields.io/npm/v/@degreesign/chat.svg)](https://www.npmjs.com/package/@degreesign/chat)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#licensing)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](#faq)
[![types](https://img.shields.io/badge/types-included-brightgreen.svg)](#faq)
[![architecture](https://img.shields.io/badge/architecture-view-blue.svg)](https://degreesign.github.io/ds_chat/architecture.html)

## Table of contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Enable WebGPU](#enable-webgpu)
- [Public API](#public-api)
- [Tools](#tools)
- [Status](#status)
- [Models](#models)
- [Prompt assembly](#prompt-assembly)
- [Engines and assets](#engines-and-assets)
- [Node.js](#nodejs)
- [React](#react)
- [Types](#types)
- [Architecture](#architecture)
- [FAQ](#faq)
- [Licensing](#licensing)

## Why

- On device: model weights download once, then every reply is generated locally.
- Headless: the package returns text through callbacks and renders no UI.
- Stateless: the host passes the whole message list and keeps its own history.
- Two engines: CPU through wllama and WebGPU through LiteRT-LM, behind one
  `startLLM` runtime contract.
- Images: a user turn can carry image URLs, sent only to a vision model and
  capped by the prompt budgets.
- Audio: a user turn can carry an audio URL, sent only to a model with audio
  support and capped by the prompt budgets.
- Tools: the model may call Web search, arithmetic and currency built-ins, plus
  any tool the host supplies, in the same reply.
- Reusable: the loaded model stays in memory for the next call.
- Typed: written in TypeScript with declarations for every export.
- Portable: importing and calling works in browsers, workers, React and Node.
  Local inference stays browser only.

## Install

```bash
npm install @degreesign/chat
```

```bash
yarn add @degreesign/chat
```

```bash
pnpm add @degreesign/chat
```

`@wllama/wllama`, `@wllama/wllama-compat`, `@litert-lm/core` and
`@degreesign/utils` are build-time dependencies. The engines are bundled into
the published build as dynamic chunks and their wasm assets ship beside them,
so a consumer installs nothing extra and resolves no engine import. Only the
model weights are downloaded at runtime.

The build emits:

- `dist/browser/chat.min.mjs`, the ESM browser entry.
- `dist/browser/engine-wllama.min.mjs` and
  `dist/browser/engine-litert.min.mjs`, the bundled engines, fetched only when
  a matching model starts.
- `dist/node/chat.node.min.js` and `chat.node.min.mjs`, the CommonJS and ESM
  Node entries, with the same engine chunks beside them.
- `dist/assets/wllama/`, the wllama wasm binaries and compat worker.
- `dist/assets/litert/`, the LiteRT-LM wasm glue and binary.
- `dist/index.d.ts`, declarations for every export.

Build from source with `yarn build`; typecheck with `yarn typecheck`; test the
built Node entry with `yarn verify:node`.

## Quick start

Build the full prompt, call `createChat`, and render the accumulated text. The
call returns one cancel function and starts the model behind the status
callback.

```ts
import { LlmRole, createChat, preloadModel } from "@degreesign/chat";

const messages = [
  { role: LlmRole.system, content: "Answer in two sentences." },
  { role: LlmRole.user, content: "Hello" },
];

// Optional: download and load the model before the first send.
await preloadModel();

const cancel = createChat({
  messages,
  onResponse: (text) => renderReply(text),
  // onThinking: (text) => renderThinking(text),
  // onSpeed: (tokensPerSecond) => renderSpeed(tokensPerSecond),
  // onStatus: (snapshot) => renderStatus(snapshot),
});

// Later, stop the reply, cancel the load, or free the model.
cancel();
```

Without `model` the package picks the GPU model when the browser provides a
WebGPU adapter and the CPU model when it does not. `limits`, `reasoning`,
`onThinking`, `onSpeed` and `onStatus` are optional per call; see the API
below.

There is no promise and no controller object on `createChat`. Every result
arrives through `onResponse`, and `onStatus` reports `requesting: false` when
the reply ends. `onSpeed` reports the streamed generation speed in tokens per
second, measured from the first token so prompt processing is excluded.
`preloadModel` is the one promise: it resolves once the model is loaded, or
`false` when it cannot load.

Attach images to a user turn with `images: [dataUrl]`. The package sends them
only to a model with vision support, center-crops each image to a square,
resizes it to 288 x 288, and caps the number with `limits.maxImages`. The
WebGPU engine asks LiteRT for the smallest Gemma 4 vision budget (70 tokens,
630 patches), so it encodes the crop at 384 x 384 instead of upscaling it to
768 x 768. The CPU engine uses the 288 crop directly. On a phone or tablet,
Gemma runs the text-only browser build, so images there go through
`qwen3_vl_2b` instead.

Attach a recording with `audio: [dataUrl]`. Gemma 4 E2B accepts WAV, MP3 and
FLAC on the desktop WebGPU engine and loads its audio encoder on demand. A short
16 kHz mono WAV is the best input. `limits.maxAudio` caps the clips (default 1).
A model without audio drops the clip when the turn also has text; an audio-only
turn reports `Model does not accept audio`. The phone build is text only, so
audio follows the same rule as images there. The package does not transcode, so
the host supplies one of those formats.

The package never writes storage, so the host appends the user message before
the call and appends the assistant message after the last `onResponse`.

## Enable WebGPU

A request without `model` picks `gemma4_e2b` when the browser exposes a WebGPU
adapter and `qwen3_vl_2b` when it does not. A phone or tablet asking for Gemma
gets `gemma-4-E2B-it-gpu.litertlm`, the 2.0 GB browser build, which is text
only. A desktop gets the 2.6 GB multimodal build with vision and audio. Hosts
that need images on mobile pass `qwen3_vl_2b`; audio is desktop only. The GPU
engine is far faster on a desktop, so check the browser before blaming the
package:

```js
// Run in the console of the page that loads the package
const adapter = await navigator.gpu?.requestAdapter();
adapter
    ? `${adapter.info.vendor} ${adapter.info.architecture}`
    : `no adapter`;
```

`null` means the browser has the API but no usable adapter, and the package
falls back to the CPU model. Chromium browsers report the whole state at
`chrome://gpu`: `WebGPU` should read `Hardware accelerated` and `Vulkan` should
read `Enabled`. Firefox lists the detected features at `about:support` under
`Graphics`.

### Firefox

WebGPU ships enabled on Windows and macOS. On Linux, and on any build that
reports `navigator.gpu` as undefined:

1. Open `about:config`.
2. Set `dom.webgpu.enabled` to `true`.
3. Restart the browser and run the snippet again.

Firefox runs WebGPU on its own wgpu stack, so an adapter can appear even with a
software driver. Check the renderer in `about:support` when replies feel slow.

### Chrome, Edge and Brave

WebGPU ships enabled on Windows, macOS and ChromeOS since version 113, so there
is nothing to configure.

On Linux the GPU process only exposes an adapter when ANGLE runs on Vulkan,
which is not the default. Start the browser with both flags:

```bash
google-chrome --enable-features=Vulkan --use-angle=vulkan
microsoft-edge --enable-features=Vulkan --use-angle=vulkan
brave-browser --enable-features=Vulkan --use-angle=vulkan
```

Either flag alone leaves `requestAdapter()` returning `null`. To keep them, add
them to the `Exec` line of the browser entry under
`~/.local/share/applications`, or to the target of a desktop shortcut.

`--enable-unsafe-webgpu` is a different switch: it only unlocks software
adapters, so an adapter whose `info.vendor` reads `google` is SwiftShader on the
CPU, not the GPU. Remove it when measuring speed. Headless Chromium hides
`navigator.gpu` unless it starts with `--enable-unsafe-webgpu`,
`--enable-features=Vulkan,WebGPU` and `--use-angle=vulkan`; check the adapter
there too, because a missing adapter silently selects the CPU model.

### GPU memory, images and audio

The WebGPU engine keeps the model, its KV cache and the vision encoder in GPU
memory. The vision encoder loads on the first image turn. The audio encoder
runs on the CPU backend the Gemma 4 build requires and loads on the first audio
turn. A card that is already busy can lose the device (`VK_ERROR_DEVICE_LOST`)
on the first image turn. The package requests the smallest Gemma 4 vision
budget, 70 tokens and 630 patches, so the encoder runs one small signature and
the crop is resized to 384 x 384 rather than the full 768 x 768. If the error
still appears, close other GPU tabs, unload the model, or switch to the CPU
model. A lost device needs a page or model reload; later calls cannot reuse it.
A phone or tablet uses the text-only browser build, so it never starts the
vision or audio encoder.

## Public API

```ts
createChat(input: ChatInput): CancelChat
preloadModel(input?: ChatPreloadInput): Promise<boolean>
```

Call it once per response. A new call aborts the previous stream. When the
requested model is already loaded, no download or load happens.

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
| `onStatus?` | Receives a `ChatStatusSnapshot` on every state change. |
| `builtins?` | Built-in tools to attach, all three by default; `false` attaches none. |
| `websearch?` | `WebSearchConfig` for the built-in search, provider, language and limits. |
| `tools?` | Extra `ChatTool` entries, appended after the built-ins. |
| `onToolCall?` | Receives a `ChatToolCall` before a tool runs. |
| `onToolResult?` | Receives a `ChatToolResult` when a tool returns or throws. |
| `maxToolRounds?` | Ceiling on tool rounds in one reply, default 4, clamped 1 to 25. |

Without `model` the package picks the GPU build when the browser provides a
WebGPU adapter and the CPU build when it does not. The budget defaults are 250
reply tokens, 128 CPU thinking tokens, 1200 GPU reasoning tokens (320 on the
CPU), 2 images, 1 audio clip, 1000 characters per message, 10000 prompt
characters and 6 CPU threads.

`CancelChat` is `() => void`. Its meaning depends on the current state:

| State | Effect |
| ----- | ------ |
| Downloading or loading | Stops waiting for the load. Bytes stay on disk, and a download another caller waits for keeps going. |
| Ready | Aborts the reply and unloads the model. |
| An older call | Nothing, because a newer call owns the runtime. |

The model stays loaded between calls until a cancel frees it. One model
download serves every caller: a chat that joins a preload shares its progress
and never starts a second download.

### Preload

```ts
preloadModel(input?: ChatPreloadInput): Promise<boolean>
```

Call it before the first `createChat` to download and load the model early. It
resolves `true` when the runtime is ready and `false` when the model is unknown,
unsupported or failed. A later `createChat` for the same model reuses the loaded
runtime, and either call joins a load already in flight. A preload owns no cancel
function, so a chat that joins its download and is cancelled leaves the download
running.

`ChatPreloadInput` is the subset of `ChatInput` that a preload needs:

| Field | Description |
| ----- | ----------- |
| `model?` | `ChatModelId` to download and load. Defaults like `ChatInput.model`. |
| `limits?` | Partial `LlmLimits`; `maxThreads` applies when the model loads. |
| `logging?` | Whether package and engine console logs are written. Defaults to `false`. |
| `onStatus?` | Receives a `ChatStatusSnapshot` on every progress and state change. |

The final snapshot reports `ready: true`, `phase: LlmPhase.load` and
`percent: 100` on success, or an `error` with `availability: ChatStatus.offline`
on failure. A preload owns no cancel function; a new load replaces it.

## Tools

Gemma 4 E2B on the WebGPU engine can call tools. A reply may contain a tool
call, the package runs it, feeds the result back and lets the model answer, all
inside the one `createChat` call. Qwen3-VL 2B and the CPU engine never receive
tools: `ChatStatusSnapshot.supportsTools` reports `false` there, the built-ins
are dropped and a host tool ends the call with `Model does not accept tools`.

Three built-ins ship and all three attach by default:

| `BuiltinTool` | What it does |
| ------------- | ------------ |
| `websearch` | Searches Wikipedia by default, or DuckDuckGo, and returns a few hits. |
| `calculate` | Evaluates an arithmetic expression with a safe parser. |
| `currency` | Quotes and converts fiat, crypto and metals with the 24-hour change. |

```ts
import { BuiltinTool, WebSearchProvider, createChat } from "@degreesign/chat";

const cancel = createChat({
  messages,
  // all three by default; narrow or disable them here
  builtins: [BuiltinTool.calculate, BuiltinTool.currency],
  websearch: { provider: WebSearchProvider.wikipedia, language: "en", limit: 3 },
  onToolCall: (call) => renderToolStart(call),
  onToolResult: (result) => renderToolEnd(result),
  onResponse: (text) => renderReply(text),
});
```

`builtins: false` disables every built-in. A tool is only offered to the model
when the model accepts tools, so the default set costs nothing on the CPU
engine.

### Custom tools

`ChatInput.tools` is the extension point, with no registration and no global
state. Each mention is appended after the built-ins and offered in the same
conversation.

```ts
import { createChat } from "@degreesign/chat";

const cancel = createChat({
  messages,
  tools: [
    {
      name: "lookup_order",
      description: "Read one order from the shop.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "Order id" },
        },
        required: ["id"],
      },
      execute: async ({ id }) => await shop.order(String(id)),
    },
  ],
  onToolCall: (call) => renderToolStart(call),
  onToolResult: (result) => renderToolEnd(result),
  onResponse: (text) => renderReply(text),
});
```

- `name` is required and unique. A host tool named `websearch`, `calculate` or
  `currency` replaces that built-in.
- `description` and `parameters` reach the model as written.
- `execute` receives the parsed arguments and may return a value or a promise.
  A thrown error becomes a tool error the model reads, and `onToolResult`
  receives `error`.
- Tools and callbacks are captured when the conversation is created. Rebuilding
  the array with the same functions and declarations reuses the conversation;
  changing a declaration or a function opens a new one and pays one history
  prefill.
- The package cannot abort a running `execute`. A cancel stops generation and
  discards its result.
- The package neither clamps nor times out a host result. Keep it small: three
  declarations already cost roughly 200 to 250 of the 4096 context tokens.

### Search

`websearch` sends one query and returns a short list of `title`, `url` and
`snippet`.

| `WebSearchConfig` | Default | Meaning |
| ----------------- | ------- | ------- |
| `provider` | Wikipedia | `WebSearchProvider.wikipedia` or `.duckduckgo`. |
| `language` | `en` | Wikipedia edition, two or three letters plus an optional region. |
| `limit` | 3 | Hits asked of the provider, clamped 1 to 20. |
| `snippetLength` | 400 | Characters kept per snippet. |
| `timeout` | 8000 | Request budget in milliseconds. |

Wikipedia is the default because its REST search has CORS `*`, no key and a
predictable result shape. DuckDuckGo returns an instant answer and related
topics, and many queries have neither, so it can return an empty list. Both
endpoints are public and keyless.

### Calculator

`calculate` accepts `+`, `-`, `*`, `/`, `%`, `^` and parentheses, and returns
`{ expression, result }`.

- `×`, `÷` and `−` are normalized, and thousands commas and spaces are removed.
- No implicit multiplication: write `2*(3+4)`.
- No functions: use `^0.5` for a square root.
- `%` is a postfix division by 100, so `200*15%` is 30 and `200+10%` is 200.1.
- Unbalanced parentheses, division by zero, an unknown character, an expression
  over 200 characters and a non-finite result are errors.
- The parser is hand written. The package never uses `eval` or `new Function`.

### Currency

`currency` reads one public price file published by [CoinExams](https://coinexams.com)
and answers from it.

- Every rate is quoted against `EUR`, which is always 1.
- Fiat and metals come from the fiat section. Crypto comes from the coin
  section, which wins when a symbol appears in both.
- Metals are `XAU`, `XAG`, `XPT` and `XPD`, quoted per gram. A zero or missing
  quote is unavailable.
- Arguments are `from` (required), `to` (default `EUR`) and `amount` (default 1).
- A result carries `from`, `to`, `amount`, `rate`, `result`, `updatedAt` and
  `stale`, plus `previousRate`, `change` and `changePercent` when the feed has a
  24-hour value for both symbols.

The feed is cached on the device under `degreesign-chat-prices-v1` in
`localStorage`. Fiat and metals refresh at most hourly, crypto at most every
five minutes, and concurrent calls share one fetch. A failed refresh keeps the
previous snapshot, serves it with `stale: true` and waits 30 seconds before the
next attempt. `navigator.onLine === false` skips the fetch and serves the cache.
With no cache and no network the tool reports `Prices unavailable offline`.

### Privacy

Search sends the model's query to the chosen provider, and currency fetches the
public price file. Nothing else leaves the device, and no key is sent. To keep a
call fully local, pass `builtins: [BuiltinTool.calculate]`, which computes on
device.

## Status

`ChatStatusSnapshot` is the only lifecycle signal:

| Field | Description |
| ----- | ----------- |
| `availability` | `ChatStatus.online`, `.away` or `.offline`, derived from `status`. |
| `status` | `LlmStatus`: `idle`, `downloading`, `ready`, `error` or `unsupported`. |
| `backend` | `LlmBackend.cpu`, `.gpu` or `.none`. |
| `supportsImages` | Whether the requested model accepts images. |
| `supportsAudio` | Whether the requested model accepts audio. |
| `supportsTools` | Whether the requested model accepts tool declarations. |
| `ready` | Whether a model is loaded and accepts a reply. |
| `loading` | Whether a download or load is in flight. |
| `requesting` | Whether a reply is streaming right now. |
| `phase` | `LlmPhase.download` or `.load`. |
| `percent` | Download or load progress, `0` to `100`. |
| `error?` | The last failure, cleared when a reply starts. |

The first snapshot fires synchronously inside `createChat`. A final snapshot
with `requesting: false` marks the end of the call.

A stream that never produces its first chunk ends with an error after 180
seconds instead of waiting forever. Once a chunk has arrived, 30 seconds of
silence ends the stream and keeps the text already delivered.

## Logging

Console output stays off by default. Pass `logging: true` in a call to receive
the package's censored engine logs, the wllama engine's own logs and the
LiteRT-LM wasm diagnostics for that call. The flag is per call, so a later call
without it goes quiet again.

## Models

| `ChatModelId` | Name | Reasoning | Images | Audio | Tools | CPU | WebGPU |
| ------------- | ---- | --------- | ------ | ----- | ----- | --- | ------ |
| `qwen3_vl_2b` | Qwen3-VL 2B | Yes | Yes | No | No | Yes | No |
| `gemma4_e2b` | Gemma 4 E2B | Yes | Desktop | Desktop | Yes | No | Yes |

A phone or tablet asking for Gemma gets the browser build,
`gemma-4-E2B-it-gpu.litertlm`, which is text only. It has no vision or audio
encoder, so `supportsImages` and `supportsAudio` report `false` there. Use
`qwen3_vl_2b` for images on mobile.

The first call downloads the model before its engine loads it. Later calls
reuse the loaded runtime. Only one model stays in memory. An interrupted
download keeps every part it committed and resumes from the last one on the
next attempt, including after a reload.

Qwen3-VL 2B downloads a vision projector of about 445 MB with the model, so its
total download is about 1.5 GB. It runs on the CPU engine, with a 4096 token
context on a phone and 8192 on a desktop. Its projector runs on two CPU threads
because more threads stall the encoder, so its image turns are slower than the
Gemma 4 WebGPU path. Use the GPU model when images need to be fast.

Gemma 4 E2B downloads `gemma-4-E2B-it.litertlm`, about 2.6 GB, on a desktop. It
runs on the WebGPU engine with its vision and audio encoders in the same file,
so an image or audio prompt does not download a projector. A phone or tablet
instead downloads the 2.0 GB `gemma-4-E2B-it-gpu.litertlm`, the precompiled
GPU_ARTISAN build Google ships for browsers. The smaller file is what keeps a
mobile tab alive at the end of the model load.

The WebGPU engine keeps one LiteRT conversation for consecutive turns. When the
next prompt continues that history, only the new user turn is sent. A changed
history opens a fresh conversation, and older images and audio become `[image]`
and `[audio]` notes in its preface.

## Prompt assembly

The `messages` array is the whole prompt. The package bounds it and shapes it
for the engine; it adds no identity, language or task text of its own.

```text
system:    {system messages, in list order}
user:      {first user turn}
assistant: {next turn}
user:      {next turn}
```

- Leading assistant turns are dropped, because the transcript must start with a
  user turn.
- Consecutive same-role turns are merged.
- Messages with no text, images or audio are skipped.
- `maxContentLength` clips each message and `promptCharBudget` bounds the whole
  prompt.
- System messages are folded into one leading system turn.
- User turns may carry `images` or `audio`. They are sent only to a model with
  vision or audio support.
- Images are collected from the newest turns first and capped by `maxImages`
  (default 2). Older image parts are dropped and their text stays.
- Every image part is center-cropped to a square, then resized to 288 x 288.
  Non-square edges are discarded and smaller images are upscaled. The WebGPU
  engine is told to use a 70-token vision budget, so it encodes the crop at
  384 x 384, the smallest Gemma 4 encoder signature.
- Audio is collected from the newest turns first and capped by `maxAudio`
  (default 1). Older audio parts are dropped and their text stays. WAV, MP3 and
  FLAC are accepted, and a short 16 kHz mono WAV is the best input.
- Image and audio payloads do not count against `promptCharBudget`.
- An image-only turn with a text model reports `Model does not accept images`,
  and an audio-only turn reports `Model does not accept audio`.

## Engines and assets

The engine is chosen per model:

1. WebGPU through LiteRT-LM when the model has a `litert` artifact and the
   browser exposes `navigator.gpu` and `WebAssembly`.
2. CPU through wllama when the model has a `cpu` artifact and the process
   exposes `WebAssembly`.
3. `LlmStatus.unsupported` otherwise, including Node.

Both engines implement the internal `startLLM({ model, limits, signal,
onProgress })` contract and return the runtime object with `model`, `backend`,
`contextSize`, `chat()` and `unload()`. `createChat` starts the engine that
matches the requested model.

The CPU engine derives a raw thread count from the device, then caps it at
`limits.maxThreads`, default 6. The cap is applied after the raw maximum, so the
engine never exceeds the device or the caller budget.

The CPU engine needs cross-origin isolation for its threads. Serve the page with
both headers:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Then assert `crossOriginIsolated === true` in the page. Without isolation the
engine falls back to one thread and image encoding becomes much slower, since
the projector runs on the CPU.

Under `require-corp` every cross-origin subresource must be CORS enabled or
carry `Cross-Origin-Resource-Policy`. Hugging Face downloads already qualify;
third party images, fonts and embeds need `crossorigin="anonymous"` or must be
self hosted. Chromium also accepts
`Cross-Origin-Embedder-Policy: credentialless` when those assets cannot be
changed. A page inside an iframe is isolated only when every ancestor sets the
same headers.

Each engine keeps its own cache. Loading a model unloads the previous runtime
and removes the previous model's cache. Both engines store model files in the
origin private file system as numbered parts, under `wllama-store` for the CPU
engine and `litert-store` for the GPU engine. The GPU engine also reads a Cache
Storage entry under `litertlm-models` when an older version stored the file. A
quota failure keeps the parts already stored, so freeing disk lets the next
attempt resume.

Both engines store the files before they load them, and one download serves
every caller. A failed load, a cancelled call or a repeated `createChat` reads
the stored parts instead of downloading them again. A download fetches bounded
ranges of 32 MB, commits each part as it arrives and retries a stalled or cut
connection from the last committed byte, so a reload loses at most one part.
Each attempt checks the file size and entity tag, and a changed model starts
over. A host that ignores the range replays the stored prefix and keeps the
parts already stored. Hosts without a writable file system still stream from
the network; the CPU engine falls back to the wllama cache manager and the GPU
engine to Cache Storage, without resuming.

A CPU vision model downloads its projector with the model and stores both files
as parts. A GPU vision model keeps its encoder in the single `.litertlm` file.

Both engines are bundled into `dist/browser` and `dist/node` as dynamic chunks.
The package ships the wllama binaries under `dist/assets/wllama` and the LiteRT
wasm under `dist/assets/litert`; model weights remain external.

LiteRT-LM needs WebGPU and the JSPI and relaxed SIMD wasm features, currently
available in Chromium. It loads a 22.7 MB wasm binary from `dist/assets/litert`
and the 2.6 GB model file. The GPU engine reports progress while the file
downloads and 100% of the load phase while the model compiles.

wllama needs the compat worker on the same origin. When the app serves the
package from `node_modules` in development, auto resolution works. In
production, copy `dist/assets/wllama` next to the app bundle so the resolved
asset URLs stay valid. The LiteRT wasm glue finds its binary in the same
directory, so copy `dist/assets/litert` beside the bundle as well.

## Node.js

The package imports and runs without a DOM, so it works in scripts, tests, SSR
and server side orchestration. Everything except inference is available: prompt
assembly, budgets, status state and cancellation.

Both engines need a browser: wllama needs a worker and a wasm runtime, and
LiteRT-LM needs WebGPU. In Node, `createChat` reports
`LlmStatus.unsupported` and `ChatStatus.offline` through `onStatus`, and the
reply callbacks stay silent. `preloadModel` resolves `false` and reports the
same unsupported status.

```js
const { createChat, preloadModel, ChatModelId, LlmRole } = require("@degreesign/chat");
```

```js
import { createChat, preloadModel, ChatModelId, LlmRole } from "@degreesign/chat";
```

The Node entries are `dist/node/chat.node.min.js` for `require` and
`dist/node/chat.node.min.mjs` for `import`. The package exports map selects them
through the `node` condition and the browser bundle through the `browser`
condition.

## React

Call `createChat` from the send handler, keep the cancel function in a ref, and
unmount it with the panel. The package never touches the DOM while it is
imported or called, so the same module renders during SSR.

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
      messages: [
        ...history,
        { role: LlmRole.user, content: text },
      ],
      onResponse: setReply,
    });
  };

  return { reply, send };
};
```

## Types

| Type | Description |
| ---- | ----------- |
| `ChatInput` | One request: model, messages, budgets, reasoning and callbacks. |
| `ChatPreloadInput` | Model, limits, logging and status, the subset `preloadModel` needs. |
| `CancelChat` | The function returned by `createChat`. |
| `ChatMessage` | One prompt turn, `role`, `content` and optional `images` and `audio`. |
| `ChatStatusSnapshot` | Availability, engine status, backend, progress and request state. |
| `LlmLimits` | Token, prompt, image, audio and thread budgets, all overridable. |
| `WllamaAssets` | Wasm, compat wasm and compat worker URLs. |
| `ChatTool` | One tool: `name`, `description`, `parameters` and `execute`. |
| `ChatToolSchema` | The JSON-schema subset a tool parameter declares. |
| `ChatToolValue` | A JSON-safe argument or result value. |
| `ChatToolCall` | One model call: `id`, `name` and parsed `arguments`. |
| `ChatToolResult` | A finished call, with `result` or `error`. |
| `WebSearchConfig` | Provider, language, limit, snippet length and timeout. |
| `WebSearchResult` | One hit: `title`, `url` and `snippet`. |

The public enums are `ChatModelId`, `LlmRole`, `ChatStatus`, `LlmStatus`,
`LlmBackend`, `LlmPhase`, `BuiltinTool` and `WebSearchProvider`.

## Architecture

An interactive map of the package lives at
[degreesign.github.io/ds_chat/architecture.html](https://degreesign.github.io/ds_chat/architecture.html). It covers
the two entries, every source module with line numbers, the helper edges and the
send flow.

## FAQ

### What is @degreesign/chat?

A headless on-device inference controller. It loads one model, streams one reply
and reports status; the app owns the chat history, storage and UI.

### Does it store messages?

No. The host passes the full prompt on every call and keeps the reply.

### Does it support images?

Yes, on models with vision support. Put image URLs in a user turn's `images`
array. Qwen3-VL 2B accepts images on the CPU engine and Gemma 4 E2B accepts
images on the desktop WebGPU engine. On a phone or tablet Gemma runs the
text-only browser build, so use `qwen3_vl_2b` for mobile images. Each image is
center-cropped to a square and resized to 288 x 288 before the engine sees it.
The WebGPU engine encodes that crop at 384 x 384 with the smallest Gemma 4
vision budget. A model without vision drops images when the turn also has text;
an image-only turn reports `Model does not accept images`.

### Does it support audio?

Yes, on models with audio support. Put an audio URL in a user turn's `audio`
array. Gemma 4 E2B accepts WAV, MP3 and FLAC on the desktop WebGPU engine, and a
short 16 kHz mono WAV is the best input. `limits.maxAudio` caps the clips
(default 1). Audio is desktop only; the mobile browser build has no audio
encoder. The package does not transcode, so the host supplies one of those
formats. A model without audio drops the clip when the turn also has text; an
audio-only turn reports `Model does not accept audio`.

### Does it need a server?

No. Local chat, model download and inference work without a server. The package
includes no server component.

### Does it have runtime dependencies?

No runtime dependencies. `@wllama/wllama`, `@wllama/wllama-compat`,
`@litert-lm/core` and `@degreesign/utils` are build-time dependencies, bundled
into the dynamic engine chunks, the chat bundle and their wasm assets, so
consumers resolve no engine import and download no engine code beyond the chunk
they use.

### Where are the models stored?

Both engines store model files in the origin private file system as resumable
parts, under `wllama-store` for the CPU engine and `litert-store` for the GPU
engine. The GPU engine also reads a Cache Storage entry under `litertlm-models`
when an older version stored the file. The package stores no model data itself.

### Which model should I pick?

Qwen3-VL 2B supports reasoning and images on the CPU. Gemma 4 E2B supports
reasoning, images and audio on desktop WebGPU, with much faster media prompts
but a larger download and a slower first compile. Use Qwen for broad browser
support and for mobile images. Use Gemma on a desktop with Chromium WebGPU, or
on a phone for text with the smaller browser build.

## Licensing

The runtime code is MIT licensed. The inference engine and model weights are
distributed by their authors under their own terms. Their items and terms are
listed in `THIRD_PARTIES.md`. See `LICENSE`.

## Keywords

`@degreesign/chat`, on-device AI chat, local LLM, wllama, litert, webgpu, gemma,
wasm, chat controller, headless chat, TypeScript, browser, speech friendly
replies.
