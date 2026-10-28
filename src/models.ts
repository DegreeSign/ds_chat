import { ChatModelId } from './enums';
import type {
    ChatModel,
    GpuNavigator,
    MobileNavigator,
} from './types';

/** Resolved default model, probed once per session */
let defaultModel: Promise<ChatModelId | undefined> | undefined;

const
    /** Milliseconds allowed for the WebGPU adapter probe */
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
                    file: `mmproj-F16.gguf`,
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
        {
            // a phone tab cannot load the multimodal build
            id: ChatModelId.gemma4_e2b_limited,
            reasoning: true,
            litert: {
                repo: `litert-community/gemma-4-E2B-it-litert-lm`,
                file: `gemma-4-E2B-it-gpu.litertlm`,
                vision: false,
                audio: false,
            },
        },
    ],
    /** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
    cpuContextWindow = 8192, // max 262_400
    /** CPU window on a phone, the smaller cache keeps the tab alive */
    mobileCpuContextWindow = 4096, // max 32_768
    /** Context window requested from the GPU engine, the wasm heap holds the model */
    litertContextWindow = 4096, // max 32_768
    /** Whether this client is a phone or tablet */
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
    /** Build of a Gemma request that this device loads */
    deviceModelId = (
        id?: ChatModelId,
        mobile: boolean = mobileDevice(),
    ): ChatModelId | undefined => {
        if (id == ChatModelId.gemma4_e2b && mobile)
            return ChatModelId.gemma4_e2b_limited;
        return id;
    },
    /** Look up a catalog entry by id */
    findLlmModel = (id?: string): ChatModel | undefined =>
        id ? llmModels.find(model => model.id == id) : undefined,
    /** Whether this browser provides a WebGPU adapter */
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
    /** Default model, the GPU one when a WebGPU adapter exists */
    defaultLlmModel = async (): Promise<ChatModelId | undefined> => {
        if (!defaultModel)
            defaultModel = (async () => (await gpuAdapter()
                ? deviceModelId(ChatModelId.gemma4_e2b)
                : ChatModelId.qwen3_vl_2b))();
        return await defaultModel;
    },
    /** Resolve the requested model or the default of this device */
    resolveLlmModel = async (id?: ChatModelId): Promise<ChatModel | undefined> =>
        findLlmModel(deviceModelId(id ?? await defaultLlmModel())),
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
    mobileDevice,
    deviceModelId,
    findLlmModel,
    gpuAdapter,
    defaultLlmModel,
    resolveLlmModel,
    supportsImages,
    supportsAudio,
};
