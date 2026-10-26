import { ChatModelId } from './enums';
import type { ChatModel, GpuNavigator } from './types';

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
        {
            id: ChatModelId.gemma4_e2b,
            reasoning: true,
            litert: {
                repo: `litert-community/gemma-4-E2B-it-litert-lm`,
                file: `gemma-4-E2B-it.litertlm`,
                vision: true,
                audio: true,
            },
        },
    ],
    /** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
    cpuContextWindow = 8192,
    /** Context window requested from the GPU engine, the wasm heap holds the model */
    litertContextWindow = 4096,
    /** Look up a catalog entry by id */
    findLlmModel = (id?: string): ChatModel | undefined =>
        id ? llmModels.find(model => model.id == id) : undefined,
    /** Whether this browser provides a WebGPU adapter */
    gpuAdapter = async (): Promise<boolean> => {
        const gpu = typeof navigator == `undefined`
            ? undefined
            : (navigator as GpuNavigator).gpu;
        if (!gpu) return false;
        try {
            return !!(await gpu.requestAdapter({
                powerPreference: `high-performance`,
            }));
        } catch { return false; };
    },
    /** Default model, the GPU one when a WebGPU adapter exists */
    defaultLlmModel = async (): Promise<ChatModelId | undefined> =>
        (await gpuAdapter()
            ? llmModels.find(model => !!model.litert)
            : llmModels.find(model => !!model.cpu))?.id,
    /** Resolve the requested model or the default of this device */
    resolveLlmModel = async (id?: ChatModelId): Promise<ChatModel | undefined> =>
        id ? findLlmModel(id) : findLlmModel(await defaultLlmModel()),
    /** Whether a model accepts images */
    supportsImages = (model: ChatModel): boolean =>
        !!model.cpu?.mmproj || !!model.litert?.vision,
    /** Whether a model accepts audio */
    supportsAudio = (model: ChatModel): boolean =>
        !!model.cpu?.mmproj?.audio || !!model.litert?.audio;

export {
    llmModels,
    cpuContextWindow,
    litertContextWindow,
    findLlmModel,
    gpuAdapter,
    defaultLlmModel,
    resolveLlmModel,
    supportsImages,
    supportsAudio,
};
