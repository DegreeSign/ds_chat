// Real-weight model switch check.
// Bundled by test/webpack.switch.config.cjs and driven by test/switch.cjs.
// Proves that requesting a second model releases the first one.
import { litertEngine } from '../src/engines/litert';
import { wllamaEngine } from '../src/engines/wllama';
import { resolveLlmLimits } from '../src/engines/engine';
import { findLlmModel } from '../src/models';
import { createRuntime } from '../src/service';
import { ChatModelId, LlmRole, LlmStatus } from '../src/enums';
import type {
    ChatModel,
    LlmEngine,
    LlmLimits,
    LlmRuntime,
    StartLlmParams,
} from '../src/types';

interface Step {
    name: string,
    ok: boolean,
    detail?: unknown,
}

const
    events: string[] = [],
    steps: Step[] = [],
    results = document.getElementById(`results`)!,
    write = (text: string) => { console.log(text); },
    publish = () => {
        results.textContent = JSON.stringify({ done: true, events, steps });
    },
    record = (name: string, ok: boolean, detail?: unknown) => {
        steps.push({ name, ok, detail });
        write(`STEP ${name} ${ok ? `ok` : `FAIL`} ${
            detail === undefined ? `` : JSON.stringify(detail)}`);
        results.textContent = JSON.stringify({ done: false, events, steps });
    },
    same = (actual: unknown, expected: unknown): boolean =>
        JSON.stringify(actual) == JSON.stringify(expected),
    /** Wrap one engine so each load and release is visible to the run */
    counted = (name: string, engine: LlmEngine): LlmEngine => ({
        ...engine,
        startLLM: async (params: StartLlmParams): Promise<LlmRuntime> => {
            events.push(`start ${name}:${params.model.id}`);
            const started = await engine.startLLM(params);
            return {
                ...started,
                unload: async () => {
                    events.push(`unload ${name}:${params.model.id}`);
                    await started.unload();
                },
            };
        },
        purge: async () => {
            events.push(`purge ${name}`);
            await engine.purge();
        },
    }),
    runtime = createRuntime({
        engines: {
            cpu: counted(`cpu`, wllamaEngine),
            litert: counted(`gpu`, litertEngine),
        },
    });

const
    /** Reply budget, short turns keep the run quick */
    limitsFor = (model: ChatModel): LlmLimits =>
        resolveLlmLimits({
            maxReplyTokens: 512,
            maxThinkingTokens: 512,
            maxReasoningTokens: 512,
        }, !!model.litert),
    /** GPU device counters, patched in by the driver page */
    gpuState = () => {
        const state = (globalThis as unknown as {
            __gpu?: { adapters: number, devices: number, lost: string[] },
        }).__gpu;
        return state ? {
            adapters: state.adapters,
            devices: state.devices,
            lost: [...state.lost],
        } : undefined;
    },
    /** Load one catalog model, returning the progress it reported */
    load = async (id: ChatModelId) => {
        const
            model = findLlmModel(id)!,
            progress: number[] = [],
            start = performance.now(),
            loaded = await runtime.load({
                model,
                limits: limitsFor(model),
                logging: true,
                onProgress: value => { progress.push(value); },
            });
        return {
            loaded,
            elapsed: Math.round(performance.now() - start),
            progress: {
                count: progress.length,
                first: progress[0],
                last: progress[progress.length - 1],
                monotonic: progress.every((value, index) =>
                    index == 0 || value >= progress[index - 1]),
            },
            status: runtime.status(),
            model: runtime.model()?.id,
            backend: runtime.backend(),
            error: runtime.error(),
            gpu: gpuState(),
        };
    },
    /** Ask one short factual question on the loaded runtime */
    ask = async (id: ChatModelId) => {
        const model = findLlmModel(id)!;
        let
            reply = ``,
            thinking = ``;
        const result = await runtime.chat({
            messages: [
                { role: LlmRole.system, content: `Answer in one short sentence.` },
                { role: LlmRole.user, content: `What is the capital of France?` },
            ],
            limits: limitsFor(model),
            reasoning: false,
            logging: true,
            onReason: delta => { thinking += delta; },
            onText: delta => { reply += delta; },
        });
        return {
            reply: result || reply || undefined,
            replyLength: reply.length,
            thinkingLength: thinking.length,
        };
    },
    /** Sample the browser heap, only where the API is exposed */
    memory = async (label: string) => {
        const measure = (performance as unknown as {
            measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>,
        }).measureUserAgentSpecificMemory;
        if (!measure || !(globalThis as { crossOriginIsolated?: boolean })
            .crossOriginIsolated) return { label, available: false };
        try {
            const { bytes } = await measure.call(performance);
            return { label, available: true, mb: Math.round(bytes / 1048576) };
        } catch (error) {
            return { label, available: false, error: `${error}` };
        }
    };

const run = async () => {
    const snapshots: unknown[] = [];
    write(`webgpu=${typeof (navigator as { gpu?: unknown }).gpu} `
        + `wasm=${typeof WebAssembly}`);

    // 1. Gemma on WebGPU
    const
        gemma = await load(ChatModelId.gemma4_e2b),
        gemmaReply = gemma.loaded ? await ask(ChatModelId.gemma4_e2b) : undefined;
    snapshots.push(await memory(`gemma loaded`));
    record(`gemma loads`, gemma.loaded
        && gemma.status == LlmStatus.ready
        && gemma.model == ChatModelId.gemma4_e2b
        && !!gemmaReply?.reply, { gemma, ask: gemmaReply });

    // 2. Qwen on the CPU replaces Gemma
    const
        qwen = await load(ChatModelId.qwen3_vl_2b),
        qwenReply = qwen.loaded ? await ask(ChatModelId.qwen3_vl_2b) : undefined;
    snapshots.push(await memory(`qwen loaded`));
    record(`qwen replaces gemma`, qwen.loaded
        && qwen.status == LlmStatus.ready
        && qwen.model == ChatModelId.qwen3_vl_2b
        && qwen.backend == `cpu`
        && !!qwenReply?.reply
        && events.includes(`unload gpu:${ChatModelId.gemma4_e2b}`),
    { qwen, ask: qwenReply });

    // 3. Gemma replaces Qwen again, from the cache
    const
        back = await load(ChatModelId.gemma4_e2b),
        backReply = back.loaded ? await ask(ChatModelId.gemma4_e2b) : undefined;
    snapshots.push(await memory(`gemma reloaded`));
    record(`gemma replaces qwen`, back.loaded
        && back.model == ChatModelId.gemma4_e2b
        && back.backend == `gpu`
        && !!backReply?.reply
        && events.includes(`unload cpu:${ChatModelId.qwen3_vl_2b}`),
    { back, ask: backReply });

    // 4. The same model is reused, not reloaded
    const
        before = events.length,
        repeat = runtime.ready() ? await load(ChatModelId.gemma4_e2b) : undefined;
    record(`same model reuses runtime`, !!repeat?.loaded
        && events.length == before
        && repeat.elapsed < 1000, { repeat, addedEvents: events.slice(before) });

    // 5. An unsupported request keeps the current model resident
    const
        keptBefore = events.length,
        keptModel = runtime.model()?.id,
        unsupported = await runtime.load({
            model: {
                id: `unsupported-probe`,
                reasoning: false,
            } as unknown as ChatModel,
            limits: resolveLlmLimits(),
            onProgress: () => { },
        });
    record(`unsupported keeps current model`, unsupported == false
        && runtime.status() == LlmStatus.unsupported
        && runtime.model()?.id == keptModel
        && events.length == keptBefore, {
        status: runtime.status(),
        model: runtime.model()?.id,
        error: runtime.error(),
        addedEvents: events.slice(keptBefore),
    });

    // 6. A final unload releases whatever is still loaded
    await runtime.unload();
    record(`unload releases model`, runtime.status() == LlmStatus.idle
        && runtime.ready() == false
        && runtime.model() === undefined, {
        status: runtime.status(),
        model: runtime.model(),
        events,
    });

    record(`switches release previous model`, same(events, [
        `start gpu:${ChatModelId.gemma4_e2b}`,
        `unload gpu:${ChatModelId.gemma4_e2b}`,
        `start cpu:${ChatModelId.qwen3_vl_2b}`,
        `unload cpu:${ChatModelId.qwen3_vl_2b}`,
        `start gpu:${ChatModelId.gemma4_e2b}`,
        `unload gpu:${ChatModelId.gemma4_e2b}`,
    ]), { events });
    record(`no cache purged`, !events.some(event => event.startsWith(`purge`)),
        { events });
    write(`MEMORY ${JSON.stringify(snapshots)}`);
};

run().catch(error => {
    write(`FAILED ${error?.stack || error}`);
    record(`fatal`, false, String(error?.stack || error));
}).finally(publish);
