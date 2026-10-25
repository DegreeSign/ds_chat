import { ChatModelId } from './enums';
import type { ChatModel } from './types';

const
    llmModels: ChatModel[] = [
        {
            id: ChatModelId.qwen3_vl_2b,
            reasoning: true,
            cpu: {
                repo: `Qwen/Qwen3-VL-2B-Thinking-GGUF`,
                file: `Qwen3VL-2B-Thinking-Q4_K_M.gguf`,
                mmproj: {
                    file: `mmproj-Qwen3VL-2B-Thinking-Q8_0.gguf`,
                },
            },
        },
    ],
    /** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
    cpuContextWindow = 8192,
    /** Look up a catalog entry by id */
    findLlmModel = (id?: string): ChatModel | undefined =>
        id ? llmModels.find(model => model.id == id) : undefined,
    /** Whether a model accepts images */
    supportsImages = (model: ChatModel): boolean => !!model.cpu.mmproj;

export {
    llmModels,
    cpuContextWindow,
    findLlmModel,
    supportsImages,
};
