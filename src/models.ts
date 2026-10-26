import { ChatModelId } from './enums';
import type {
    ChatModel,
    GpuNavigator,
    LitertArtifact,
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
            id: ChatModelId.gemma4_e2b,
            reasoning: true,
            litert: {
                repo: `litert-community/gemma-4-E2B-it-litert-lm`,
                file: `gemma-4-E2B-it.litertlm`,
                vision: true,
                audio: true,
                tools: true,
                // a phone tab cannot load the multimodal build
                web: {
                    file: `gemma-4-E2B-it-gpu.litertlm`,
                    vision: false,
                    audio: false,
                    tools: true,
                },
            },
        },
    ],
    /** Context window requested from the CPU engine, a 32k KV cache needs 3.5 GB */
    cpuContextWindow = 8192,
    /** CPU window on a phone, the smaller cache keeps the tab alive */
    mobileCpuContextWindow = 4096,
    /** Context window requested from the GPU engine, the wasm heap holds the model */
    litertContextWindow = 4096,
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
    /** LiteRT file and capabilities of this device */
    litertArtifact = (
        model: ChatModel,
        mobile: boolean = mobileDevice(),
    ): LitertArtifact | undefined => {
        const litert = model.litert;
        if (!litert) return undefined;
        if (mobile && litert.web) return litert.web;
        return {
            file: litert.file,
            vision: litert.vision,
            audio: litert.audio,
            tools: litert.tools,
        };
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
                ? llmModels.find(model => !!model.litert)
                : llmModels.find(model => !!model.cpu))?.id)();
        return await defaultModel;
    },
    /** Resolve the requested model or the default of this device */
    resolveLlmModel = async (id?: ChatModelId): Promise<ChatModel | undefined> =>
        id ? findLlmModel(id) : findLlmModel(await defaultLlmModel()),
    /** Whether a model accepts images */
    supportsImages = (
        model: ChatModel,
        mobile: boolean = mobileDevice(),
    ): boolean =>
        !!model.cpu?.mmproj || litertArtifact(model, mobile)?.vision === true,
    /** Whether a model accepts audio */
    supportsAudio = (
        model: ChatModel,
        mobile: boolean = mobileDevice(),
    ): boolean =>
        !!model.cpu?.mmproj?.audio || litertArtifact(model, mobile)?.audio === true,
    /** Whether a model accepts tool declarations */
    supportsTools = (
        model: ChatModel,
        mobile: boolean = mobileDevice(),
    ): boolean =>
        litertArtifact(model, mobile)?.tools === true;

export {
    llmModels,
    cpuContextWindow,
    mobileCpuContextWindow,
    litertContextWindow,
    mobileDevice,
    litertArtifact,
    findLlmModel,
    gpuAdapter,
    defaultLlmModel,
    resolveLlmModel,
    supportsImages,
    supportsAudio,
    supportsTools,
};
