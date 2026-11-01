# Architectural Comparison: Why `@degreesign/chat` Fits Web Apps

Shipping on-device AI in a web app is a client problem before it is a model problem. A tab has a
memory ceiling, a download the user will abandon, a GPU that may or may not exist, and a UI that
must keep painting while tokens arrive. `@degreesign/chat` is built around those constraints.
`@mlc-ai/web-llm` is built around running the largest model a WebGPU adapter will accept.

---

## 1. A headless client, not a chat demo

`@degreesign/chat` owns the model lifecycle and one streaming generation. It renders no markup,
ships no styles, and keeps no copy. The host passes messages and callbacks and owns the entire
interface. That is the shape a product needs: the library disappears into the app.

The same package runs in React and in Node, imports no DOM at load time, and reports an unsupported
status instead of throwing when there is no browser. A server imports it and runs the same suite a
browser runs, without a DOM shim.

`@mlc-ai/web-llm` is an inference engine with an OpenAI-shaped chat API. The host still builds the
progress surface, the device strategy and the fallback story.

---

## 2. Two engines in one package

| | `@degreesign/chat` | `@mlc-ai/web-llm` |
| :--- | :--- | :--- |
| GPU path | LiteRT WebGPU | WebGPU |
| CPU path | wllama WebAssembly, multi-threaded | none |
| Engine choice | automatic, per device | WebGPU only |
| No WebGPU adapter | falls back to a CPU model | fails to initialize |
| Phone handling | one GPU build, half the context window on mobile | no device tuning |

The GPU engine and the CPU engine both ship inside the package and load as separate chunks. A host
installs one dependency and resolves no engine, no wasm path and no model URL.

Engine selection is automatic. The client probes for a WebGPU adapter with a 1500 ms timeout. An
adapter selects the Gemma 4 build, and no adapter selects a Qwen3-VL 2B model on the CPU. The host
reads which engine ran and which build loaded, so the interface can label itself honestly.

This is the difference between a library that works on the devices you own and one that works on
the devices your users own.

---

## 3. The `shader-f16` gate decides who runs at all

web-llm marks its Gemma 4 f16 build with a required `shader-f16` feature. Headless Chromium 156 on
this machine exposes an AMD `gcn-4` adapter (Radeon RX Vega M GH) and reports no `shader-f16`. Its
SwiftShader fallback reports none either.

| Adapter | `shader-f16` | `maxBufferSize` |
| :--- | :--- | :--- |
| AMD `gcn-4`, Radeon RX Vega M GH | false | 4.29 GB |
| SwiftShader fallback | false | 1.07 GB |

On that hardware only the web-llm f32 build starts. The LiteRT engine needs only a WebGPU adapter,
so the 2.0 GB Gemma 4 build runs there. GPUs without f16 support are not a corner case in consumer
hardware, and a client that fails to initialize on them loses those users entirely.

---

## 4. Downloads sized for a tab, not a workstation

| Build | Engine | Download | Context | Images | Audio |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Qwen3-VL 2B | CPU | 1.5 GB | 8192, 4096 mobile | yes | no |
| Qwen3-VL 2B Instruct | CPU | 1.5 GB | 8192, 4096 mobile | yes | no |
| Qwen3-VL 2B Instruct Q3 | CPU | 1.3 GB | 8192, 4096 mobile | yes | no |
| Gemma 4 E2B limited | WebGPU | 2.0 GB | 32768, 16384 mobile | no | no |

The Gemma 4 build is text only and carries no vision or audio encoder, which is what keeps the
download at 2.0 GB. Images go through Qwen3-VL on the CPU, where the projector adds 445 MB.

Both Gemma 4 builds for web-llm are 2.8 GB, and the f16 build also declares 3387 MB of VRAM, the f32
build 3863 MB. The same base model costs 800 MB more before a single token is generated.

Downloads resume. Weights land in 32 MB parts, an interrupted transfer keeps every committed part,
and the next attempt continues from the last one, including after a page reload. The client asks the
browser for persistent storage before a load so the weights survive eviction pressure.

---

## 5. Context and prefill headroom

| | `@degreesign/chat` | `@mlc-ai/web-llm` |
| :--- | :--- | :--- |
| GPU context, desktop | 32768 | 4096 |
| GPU context, mobile | 16384 | 4096 |
| Prefill chunk | engine managed | 512 |
| CPU context | 8192 desktop, 4096 mobile | no CPU path |

A 4096 token window is a short conversation. It fits a question and a brief answer, then the oldest
turns fall out. The GPU path in this package carries four times that on a phone and eight times that
on a desktop, which is the difference between a single prompt and a working chat history.

The 512 token prefill chunk in web-llm also caps how much of a long prompt the GPU ingests per step.
Long system prompts and multi-turn history are exactly what consumer chat products send.

---

## 6. Bundle footprint

| File | Size |
| :--- | :--- |
| Main browser entry | 66.7 KB |
| wllama engine chunk | 326.5 KB |
| LiteRT engine chunk | 29.6 KB |
| LiteRT wasm | 23.8 MB |
| wllama wasm | 8.8 MB |
| wllama compat wasm | 16.0 MB |

The entry stays at 66.7 KB, and each engine loads only when a model needs it. A page that runs the
CPU path never fetches the LiteRT wasm, and a GPU page never fetches the wllama wasm.

`@mlc-ai/web-llm@0.2.87` is 14.4 MB unpacked across 73 files, plus a model library wasm and the
weight shards fetched at load. That is a heavier initial surface before any model work begins.

---

## 7. Media without a second stack

Image description and translation are part of the package, not an add-on. A batch of images is
described in English on the CPU vision model, then translated one image at a time on the GPU Gemma 4
build. Without an adapter, or when the translator declines, the English text is kept.

Every result carries the English description, the translated description and the duration of that
image. A host can stop a batch and keep every finished image, append its own rules to the describer
prompt, and set the vision token budget per image.

The GPU build is text only, so image turns run on the CPU model while translation runs on the GPU.
web-llm's Gemma 4 build declares audio but has no vision path, so an image feature needs another
stack.

---

## 8. Tools and grounding included

The package ships web search, arithmetic and currency tools, with Wikipedia and DuckDuckGo as search
providers. A host defines a tool as a schema plus a function, and receives parsed calls and results.
The tool layer is part of the same install, so grounding a local model in live data needs no extra
dependency or glue code.

---

## 9. Behaviour under real UI conditions

- The newest request owns the model, and a superseded request delivers nothing.
- Cancelling aborts the generation and unloads the model, so the next turn starts from a fresh
  context instead of inheriting a broken one.
- A failed generation unloads the model for the same reason.
- A cancel during a shared load lets that load finish and reports its own outcome.
- Streamed text arrives accumulated, ready to assign to a view, with a token speed callback and a
  status snapshot covering phase, percent, engine and capability flags.
- Download and load share one progress channel, so the interface needs one bar, not two.

---

## 10. Small models are not a chat substitute

web-llm's catalog reaches much lower than this package. It can start a 135M parameter model in a
tab, and it lists several builds under 1 GB of declared VRAM:

| web-llm build | Parameters | Declared VRAM |
| :--- | :--- | :--- |
| `SmolLM2-135M-Instruct-q0f16-MLC` | 135M | 360 MB |
| `SmolLM2-360M-Instruct-q4f16_1-MLC` | 360M | 376 MB |
| `Qwen2.5-0.5B-Instruct-q4f16_1-MLC` | 0.5B | 945 MB |
| `TinyLlama-1.1B-Chat-v1.0-q4f16_1-MLC` | 1.1B | 697 MB |
| `gemma3-1b-it-q4f16_1-MLC` | 1B | 711 MB |
| `Llama-3.2-1B-Instruct-q4f16_1-MLC` | 1B | 879 MB |
| `gemma-2-2b-it-q4f16_1-MLC` | 2B | 1895 MB |

Those builds fit a small tab and start fast, and they are the reason web-llm looks attractive on
paper. Every one of them is too weak for a chat product. The 135M and 360M models answer in
fragments. The 0.5B to 2B builds open with a sentence that looks right, then forget the instruction,
invent facts, repeat themselves, and fail simple arithmetic. None of them is usable as an assistant.
They are classifiers, extractors, autocomplete engines or demo filler, and they only look adequate
until a real user types a second question.

Gemma 4 E2B at 2.0 GB is the smallest build in either package that carries a conversation: it
follows the system prompt, keeps names and numbers across turns, and reasons through a short task.
That is the floor for chat, and it is the model this package ships.

---

## Summary Verdict

| Question | `@degreesign/chat` | `@mlc-ai/web-llm` |
| :--- | :--- | :--- |
| Gemma 4 E2B without `shader-f16` | runs the 2.0 GB build | f16 build refuses to start |
| Download for text | 2.0 GB | 2.8 GB |
| Smallest usable chat build | Gemma 4 E2B, 2.0 GB | small builds, not usable for chat |
| GPU context | 32768 desktop, 16384 mobile | 4096 |
| Prefill chunk | engine managed | 512 |
| Runs without WebGPU | CPU model via wllama | no |
| Vision | CPU Qwen3-VL, in the same package | no |
| Audio | no catalog model | declared |
| Engine and model choice | automatic | host builds it |
| Main bundle | 66.7 KB | 14.4 MB unpacked |
| Phone tab survival | 2.0 GB build, 800 MB smaller | no downgrade |

Choose `@degreesign/chat` for consumer web apps, mobile PWAs and cross-platform clients where
download size, memory, hardware coverage, context length and a predictable UI contract decide
whether the feature ships. Choose `@mlc-ai/web-llm` for desktop-only tools pinned to high-end
adapters that expose `shader-f16`, where a broad model catalog matters more than the client budget.
