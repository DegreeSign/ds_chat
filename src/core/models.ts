import { ChatModelId } from '../types/enums';
import type {
    ChatModel,
    GpuNavigator,
    MobileNavigator,
} from '../types';

/** Default model probed once */
let defaultModel: Promise<ChatModelId | undefined> | undefined;

const
    /** WebGPU adapter probe timeout */
    gpuProbeTimeout = 1500,
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
            id: ChatModelId.qwen3_vl_2b_instruct,
            reasoning: false,
            cpu: {
                repo: `unsloth/Qwen3-VL-2B-Instruct-GGUF`,
                file: `Qwen3-VL-2B-Instruct-Q4_K_M.gguf`,
                mmproj: {
                    repo: `Qwen/Qwen3-VL-2B-Instruct-GGUF`,
                    file: `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf`,
                },
            },
        },
        {
            // smaller instruct build
            id: ChatModelId.qwen3_vl_2b_instruct_q3,
            reasoning: false,
            cpu: {
                repo: `unsloth/Qwen3-VL-2B-Instruct-GGUF`,
                file: `Qwen3-VL-2B-Instruct-Q3_K_M.gguf`,
                mmproj: {
                    repo: `Qwen/Qwen3-VL-2B-Instruct-GGUF`,
                    file: `mmproj-Qwen3VL-2B-Instruct-Q8_0.gguf`,
                },
            },
        },
        {
            // text-only GPU build
            id: ChatModelId.gemma4_e2b_limited,
            reasoning: true,
            litert: {
                repo: `litert-community/gemma-4-E2B-it-litert-lm`,
                file: `gemma-4-E2B-it-gpu.litertlm`,
                // pinned before web build
                revision: `3d48132a00cf76de57d926de30f5c5c5ed9b8c0d`,
                vision: false,
                audio: false,
            },
        },
        {
            // text-only web build
            id: ChatModelId.gemma4_e2b_web,
            reasoning: true,
            litert: {
                repo: `litert-community/gemma-4-E2B-it-litert-lm`,
                file: `gemma-4-E2B-it-web.litertlm`,
                // pinned web build
                revision: `3d48132a00cf76de57d926de30f5c5c5ed9b8c0d`,
                vision: false,
                audio: false,
            },
        },
    ],
    /** CPU context window, 8k tokens */
    cpuContextWindow = 8192, // max 262_400
    /** Phone CPU window, 4096 tokens */
    mobileCpuContextWindow = 4096, // max 32_768
    /** GPU context window, 32k tokens */
    litertContextWindow = 32768, // max 32_768
    /** Phone GPU window, 16k tokens */
    mobileLitertContextWindow = 16384, // max 32_768
    /** Whether this client is mobile */
    mobileDevice = (nav?: MobileNavigator): boolean => {
        const client = nav ?? (typeof navigator == `undefined`
            ? undefined
            : navigator as MobileNavigator);
        if (!client) return false;
        if (typeof client.userAgentData?.mobile == `boolean`)
            return client.userAgentData.mobile;
        const agent = client.userAgent || ``;
        return /Android|iPhone|iPad|iPod|Mobile/i.test(agent)
            || (/Macintosh/.test(agent) && client.maxTouchPoints > 1);
    },
    /** Context window of one model */
    contextWindow = (model: ChatModel): number =>
        model.litert
            ? mobileDevice()
                ? mobileLitertContextWindow
                : litertContextWindow
            : mobileDevice()
                ? mobileCpuContextWindow
                : cpuContextWindow,
    /** Find catalog entry by id */
    findLlmModel = (id?: string): ChatModel | undefined =>
        id ? llmModels.find(model => model.id == id) : undefined,
    /** Whether browser has WebGPU adapter */
    gpuAdapter = async (): Promise<boolean> => {
        const gpu = typeof navigator == `undefined`
            ? undefined
            : (navigator as GpuNavigator).gpu;
        if (!gpu) return false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const adapter = await Promise.race([
                gpu.requestAdapter({
                    powerPreference: `high-performance`,
                }),
                new Promise<undefined>(resolve => {
                    timer = setTimeout(() => resolve(undefined), gpuProbeTimeout);
                }),
            ]);
            return !!adapter;
        } catch { return false; }
        finally { if (timer) clearTimeout(timer); };
    },
    /** Default model, GPU when available */
    defaultLlmModel = async (): Promise<ChatModelId | undefined> => {
        if (!defaultModel)
            defaultModel = (async () => (await gpuAdapter()
                ? ChatModelId.gemma4_e2b_limited
                : ChatModelId.qwen3_vl_2b))();
        return await defaultModel;
    },
    /** Resolve requested model or default */
    resolveLlmModel = async (id?: ChatModelId): Promise<ChatModel | undefined> =>
        findLlmModel(id ?? await defaultLlmModel()),
    /** Whether a model accepts images */
    supportsImages = (model: ChatModel): boolean =>
        !!model.cpu?.mmproj || model.litert?.vision === true,
    /** Whether a model accepts audio */
    supportsAudio = (model: ChatModel): boolean =>
        !!model.cpu?.mmproj?.audio || model.litert?.audio === true;

export {
    llmModels,
    cpuContextWindow,
    mobileCpuContextWindow,
    litertContextWindow,
    mobileLitertContextWindow,
    contextWindow,
    mobileDevice,
    findLlmModel,
    gpuAdapter,
    defaultLlmModel,
    resolveLlmModel,
    supportsImages,
    supportsAudio,
};
