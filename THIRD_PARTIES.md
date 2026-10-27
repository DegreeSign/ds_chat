# Third Parties

`@degreesign/chat` is an independent TypeScript controller for on-device AI
chat. The package bundles each inference engine into its browser and Node
builds as a dynamic chunk. The model weights remain external and download at
runtime.

The runtime code in this repository is licensed under the
MIT License. See [LICENSE](LICENSE).

## Engines

### wllama

- License: MIT
- Source: https://github.com/ngxson/wllama
- Contents: the CPU llama.cpp wasm engine and its compat worker.

### LiteRT-LM

- License: Apache License 2.0
- Source: https://github.com/google-ai-edge/LiteRT-LM
- Contents: the WebGPU JavaScript API, its wasm glue and wasm binary.

## Model weights

The weights download at runtime and are not part of this package.

### Qwen3-VL 2B Thinking

- License: Apache License 2.0
- Source: https://huggingface.co/Qwen/Qwen3-VL-2B-Thinking-GGUF
- Contents: the Qwen3-VL thinking checkpoint in Q4_K_M GGUF form and its Q8
  vision projector.

### Gemma 4 E2B

- License: Apache License 2.0
- Source: https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
- Contents: the Gemma 4 E2B multimodal checkpoint in `.litertlm` form.

## Attribution

Each engine and weight set remains the property of its authors and is governed
by the license listed above. The licenses are granted by the original authors,
not by DegreeSign, and no affiliation with or endorsement by those authors is
implied.
