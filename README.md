# @degreesign/chat

One-shot on-device AI chat for browsers, workers and Node, running a wllama CPU
engine with a wasm fallback. The host owns the messages and the UI; the package
loads one model, streams one reply and reports status.

[![npm version](https://img.shields.io/npm/v/@degreesign/chat.svg)](https://www.npmjs.com/package/@degreesign/chat)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](#licensing)
[![node](https://img.shields.io/badge/node-%3E%3D24-brightgreen.svg)](#faq)
[![types](https://img.shields.io/badge/types-included-brightgreen.svg)](#faq)
[![architecture](https://img.shields.io/badge/architecture-view-blue.svg)](https://degreesign.github.io/ds_chat/architecture.html)

## Table of contents

- [Why](#why)
- [Install](#install)
- [Quick start](#quick-start)
- [Public API](#public-api)
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
- One engine: CPU through wllama with a wasm fallback, behind one `startLLM`
  runtime contract.
- Images: a user turn can carry image URLs, sent only to a vision model and
  capped by the prompt budgets.
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

`@wllama/wllama` and `@wllama/wllama-compat` are build-time dependencies. The
engine is bundled into the published build as a dynamic chunk and its wasm
assets ship beside it, so a consumer installs nothing extra and resolves no
engine import. Only the model weights are downloaded at runtime.

The build emits:

- `dist/browser/chat.min.mjs`, the ESM browser entry.
- `dist/browser/engine-wllama.min.mjs`, the bundled engine, fetched only when a
  model starts.
- `dist/node/chat.node.min.js` and `chat.node.min.mjs`, the CommonJS and ESM
  Node entries, with the same engine chunk beside them.
- `dist/assets/wllama/`, the wllama wasm binaries and compat worker served next
  to the browser entry.
- `dist/index.d.ts`, declarations for every export.

Build from source with `yarn build`; typecheck with `yarn typecheck`; test the
built Node entry with `yarn verify:node`.

## Quick start

Build the full prompt, call `createChat`, and render the accumulated text. The
call returns one cancel function and starts the model behind the status
callback.

```ts
import {
  ChatModelId,
  LlmRole,
  createChat,
} from "@degreesign/chat";

const messages = [
  { role: LlmRole.system, content: "Answer in two sentences." },
  { role: LlmRole.user, content: "Hello" },
];

const cancel = createChat({
  model: ChatModelId.qwen3_vl_2b,
  messages,
  limits: { maxReplyTokens: 320 },
  reasoning: false,
  onThinking: (text) => renderThinking(text),
  onResponse: (text) => renderReply(text),
  onStatus: (snapshot) => renderStatus(snapshot),
});

// Later, stop the reply, cancel the load, or free the model.
cancel();
```

There is no promise and no controller object. Every result arrives through the
three callbacks, and `onStatus` reports `requesting: false` when the reply ends.

Attach images to a user turn with `images: [dataUrl]`. The package sends them
only to a model with vision support, center-crops each image to a square,
resizes it to 288 x 288, and caps the number with `limits.maxImages`.

The package never writes storage, so the host appends the user message before
the call and appends the assistant message after the last `onResponse`.

## Public API

```ts
createChat(input: ChatInput): CancelChat
```

Call it once per response. A new call aborts the previous stream. When the
requested model is already loaded, no download or load happens.

`ChatInput`:

| Field | Description |
| ----- | ----------- |
| `model` | `ChatModelId` to use for this request. A different model replaces the loaded one. |
| `messages` | The complete prompt, including system messages and the new user turn. |
| `limits?` | Partial `LlmLimits`; `maxImages` caps images and `maxThreads` caps CPU threads (default 2). |
| `reasoning?` | Whether the model may think first. Defaults to `false`. |
| `logging?` | Whether package and engine console logs are written. Defaults to `false`. |
| `onThinking?` | Receives the accumulated reasoning text as it streams. |
| `onResponse` | Receives the accumulated reply text as it streams. Required. |
| `onStatus?` | Receives a `ChatStatusSnapshot` on every state change. |

`CancelChat` is `() => void`. Its meaning depends on the current state:

| State | Effect |
| ----- | ------ |
| Downloading or loading | Aborts the model load. |
| Ready | Aborts the reply and unloads the model. |
| An older call | Nothing, because a newer call owns the runtime. |

The model stays loaded between calls until a cancel frees it.

## Status

`ChatStatusSnapshot` is the only lifecycle signal:

| Field | Description |
| ----- | ----------- |
| `availability` | `ChatStatus.online`, `.away` or `.offline`, derived from `status`. |
| `status` | `LlmStatus`: `idle`, `downloading`, `ready`, `error` or `unsupported`. |
| `backend` | `LlmBackend.cpu` or `.none`. |
| `supportsImages` | Whether the requested model accepts images. |
| `ready` | Whether a model is loaded and accepts a reply. |
| `loading` | Whether a download or load is in flight. |
| `requesting` | Whether a reply is streaming right now. |
| `phase` | `LlmPhase.download` or `.load`. |
| `percent` | Download or load progress, `0` to `100`. |
| `error?` | The last failure, cleared when a reply starts. |

The first snapshot fires synchronously inside `createChat`. A final snapshot
with `requesting: false` marks the end of the call.

## Logging

Console output stays off by default. Pass `logging: true` in a call to receive
the package's censored engine logs and the engine's own logs for that call. The
flag is per call, so a later call without it goes quiet again.

## Models

| `ChatModelId` | Name | Reasoning | Images | CPU |
| ------------- | ---- | --------- | ------ | --- |
| `qwen3_vl_2b` | Qwen3-VL 2B | Yes | Yes | Yes |

The first call downloads the model through the CPU engine and caches it. Later
calls reuse the loaded runtime. Only one model stays in memory.

Qwen3-VL 2B downloads a vision projector of about 445 MB with the model, so its
total download is about 1.5 GB.

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
- Messages with no text and no images are skipped.
- `maxContentLength` clips each message and `promptCharBudget` bounds the whole
  prompt.
- System messages are folded into one leading system turn.
- User turns may carry `images`. They are sent only to a model with vision
  support.
- Images are collected from the newest turns first and capped by `maxImages`
  (default 2). Older image parts are dropped and their text stays.
- Every image part is center-cropped to a square, then resized to 288 x 288.
  Non-square edges are discarded and smaller images are upscaled.
- Image payloads do not count against `promptCharBudget`.
- An image-only turn with a text model reports `Model does not accept images`.

## Engines and assets

The engine is chosen per request:

1. CPU through wllama when a browser exposes `WebAssembly`.
2. `LlmStatus.unsupported` in Node or in a process without wasm.

The CPU engine implements the internal `startLLM({ model, limits, signal,
onProgress })` contract and returns the runtime object with `model`, `backend`,
`contextSize`, `chat()` and `unload()`. `createChat` starts it for the requested
model.

The CPU engine derives a raw thread count from the device, then caps it at
`limits.maxThreads`, default 2. The cap is applied after the raw maximum, so the
engine never exceeds the device or the caller budget.

Threads only take effect when the host page is cross-origin isolated. Serve it
with both headers:

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

Only one model stays on device. Loading a new model unloads the previous runtime
and deletes other model caches. A quota failure purges every model cache before
retrying, so a half written download never blocks the next attempt.

A vision model downloads its projector with the model and caches both. A cache
written before image support is replaced once, so the projector is fetched.

The engine is bundled into `dist/browser` and `dist/node` as a dynamic chunk.
The package also ships the wllama binaries under `dist/assets/wllama`, and model
weights remain external.

wllama needs the compat worker on the same origin. When the app serves the
package from `node_modules` in development, auto resolution works. In
production, copy `dist/assets/wllama` next to the app bundle so the resolved
asset URLs stay valid.

## Node.js

The package imports and runs without a DOM, so it works in scripts, tests, SSR
and server side orchestration. Everything except inference is available: prompt
assembly, budgets, status state and cancellation.

The wllama engine needs a browser worker and wasm runtime. In Node,
`createChat` reports `LlmStatus.unsupported` and `ChatStatus.offline` through
`onStatus`, and the reply callbacks stay silent.

```js
const { createChat, ChatModelId, LlmRole } = require("@degreesign/chat");
```

```js
import { createChat, ChatModelId, LlmRole } from "@degreesign/chat";
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
| `CancelChat` | The function returned by `createChat`. |
| `ChatMessage` | One prompt turn, `role`, `content` and optional `images`. |
| `ChatStatusSnapshot` | Availability, engine status, backend, progress and request state. |
| `LlmLimits` | Token, prompt, image and thread budgets, all overridable. |
| `WllamaAssets` | Wasm, compat wasm and compat worker URLs. |

The public enums are `ChatModelId`, `LlmRole`, `ChatStatus`, `LlmStatus`,
`LlmBackend` and `LlmPhase`.

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
array. Qwen3-VL 2B is the shipped model, it accepts images and runs on the CPU
engine. Each image is center-cropped to a square and resized to 288 x 288
before the engine sees it. A model without vision drops images when the turn
also has text; an image-only turn reports `Model does not accept images`.

### Does it need a server?

No. Local chat, model download and inference work without a server. The package
includes no server component.

### Does it have runtime dependencies?

No runtime dependencies. `@wllama/wllama` and `@wllama/wllama-compat` are
build-time dependencies, bundled into the dynamic engine chunk and its wasm
assets, so consumers resolve no engine import and download no engine code beyond
the chunk they use.

### Where are the models stored?

The CPU engine owns its cache through the wllama cache manager. The package
stores no model data itself.

### Which model should I pick?

Qwen3-VL 2B is the only catalog model. It supports reasoning and images and runs
on the CPU engine.

## Licensing

The runtime code is MIT licensed. The inference engine and model weights are
distributed by their authors under their own terms. Their items and terms are
listed in `THIRD_PARTIES.md`. See `LICENSE`.

## Keywords

`@degreesign/chat`, on-device AI chat, local LLM, wllama, wasm, chat controller,
headless chat, TypeScript, browser, speech friendly replies.
