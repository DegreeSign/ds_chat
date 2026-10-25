# Third Parties

`@degreesign/chat` is an independent TypeScript controller for on-device AI
chat. The package bundles the inference engine into its browser and Node builds
as a dynamic chunk. The model weights remain external and download at runtime.

The runtime code in this repository is licensed under the
MIT License. See [LICENSE](LICENSE).

## Model weights

The weights download at runtime and are not part of this package.

### Qwen3-VL 2B Thinking

- License: Apache License 2.0
- Source: https://huggingface.co/Qwen/Qwen3-VL-2B-Thinking-GGUF
- Contents: the Qwen3-VL thinking checkpoint in Q4_K_M GGUF form.

## Attribution

Each engine and weight set remains the property of its authors and is governed
by the license listed above. The licenses are granted by the original authors,
not by DegreeSign, and no affiliation with or endorsement by those authors is
implied.
