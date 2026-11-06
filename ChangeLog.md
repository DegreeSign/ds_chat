# Changelog

## 1.5.0

- Add `ChatInput.onPromptSpeed`, live prompt processing speed.

## 1.4.0

- Add `LlmLimits.gpuShare`, GPU busy share per reply.

## 1.3.0

- Add `gpuAdapter`, WebGPU probe before naming a model.
- Remove `ChatModelId.gemma4_e2b`, the multimodal Gemma build.

## 1.2.0

- Add `imageReplyTokens`, default reply budget per image.
- Add `signal` to `DescribeImagesInput` and `DescribeTranslatedInput`, cancels a batch.
- Add `DescribeImagesInput.additionalRules`, host rules for the describer.
- Add `LlmLimits.imageTokens`, vision token budget per image.

## 1.1.0

- Add `describeModelId`, model for the English pass.

## 1.0.0

- Add `describeTranslated`, translates descriptions on the GPU.
- Add `DescribeTranslatedInput`, batch translation request.
- Add `ChatModelId.qwen3_vl_2b_instruct_q3`, Q3_K_M build for descriptions.

## 0.9.2

- Add `ImageDescription.durationMs`, per-image describer time.
- Pass the duration to `DescribeImagesInput.currentIndex`, fourth callback argument.

## 0.9.0

- Add `describeImages`, English descriptions then GPU translation.
- Add `DescribeImagesInput` and `ImageDescription`, batch request and result.
- Add `ChatModelId.qwen3_vl_2b_instruct`, Q4_K_M description build.

## 0.8.0

- Add `clearModelCache`, releases model and cached files.

## 0.7.1

- Add `ChatModelId.gemma4_e2b_limited`, text-only build for phones.
- Add `ChatStatusSnapshot.model`, build after the mobile swap.

## 0.7.0

- Add `builtinTools`, websearch, calculate and currency tools.
- Add `calculateTool`, `currencyTool` and `webSearchTool`, built-in tool descriptors.
- Add `BuiltinTool` and `WebSearchProvider`, tool and provider ids.
- Add `ChatTool`, `ChatToolCall` and `ChatToolResult`, tool call shapes.
- Add `ChatToolSchema` and `ChatToolValue`, schema and value types.
- Add `WebSearchConfig` and `WebSearchResult`, search settings and result.

## 0.4.0

- Add `ChatMessage.audio`, audio URLs on a user turn.
- Add `LlmLimits.maxAudio`, audio clips per prompt.
- Add `ChatStatusSnapshot.supportsAudio`, whether the model accepts audio.

## 0.3.7

- Add `onSpeed`, generation speed in tokens per second.

## 0.2.0

- Add `preloadModel`, downloads and loads before chat.
- Add `ChatPreloadInput`, subset of chat input.

## 0.1.0

- Replace the facade with one-shot `createChat` calls, one cancel per reply.
- Add `ChatInput` and `ChatStatusSnapshot`, request input and status.
- Add `LlmLimits`, token, prompt and history budgets.
