import { litertEngine } from './engines/litert';
import { wllamaEngine } from './engines/wllama';
import { mobileDevice } from './models';
import { ChatModelId, LlmBackend, LlmPhase, LlmStatus } from './enums';
import type {
    ChatModel,
    GpuNavigator,
    LlmEngine,
    LlmRuntime,
    Runtime,
    RuntimeChatParams,
    RuntimeDeps,
    RuntimeLoadParams,
    RuntimeLoadWaiter,
} from './types';

/** One model load in flight */
interface RuntimeLoad {
    /** Catalog entry being loaded */
    model: ChatModel,
    /** Resolves once this load settles */
    attempt: Promise<boolean>,
}

const createRuntime = (deps: RuntimeDeps = {}): Runtime => {
    const
        /** CPU engine, overridable by tests */
        cpuEngine: LlmEngine = deps.engines?.cpu || wllamaEngine,
        /** GPU engine, overridable by tests */
        gpuEngine: LlmEngine = deps.engines?.litert || litertEngine,
        /** Mobile device keeps one model */
        mobile = deps.mobile || mobileDevice,
        /** Loaded models, one per backend */
        runtimes = new Map<ChatModelId, LlmRuntime>(),
        /** In-flight loads by backend */
        loads = new Map<ChatModelId, RuntimeLoad>(),
        /** Aborted loads still unwinding engine */
        settling = new Map<ChatModelId, RuntimeLoad>(),
        /** Waiters of one model load */
        waiters = new Map<ChatModelId, RuntimeLoadWaiter[]>(),
        /** Latest progress of one load */
        progress = new Map<ChatModelId, { percent: number, phase: LlmPhase }>(),
        /** Abort handle of one load */
        aborts = new Map<ChatModelId, AbortController>(),
        /** Attempt token, newer invalidates older */
        tokens = new Map<ChatModelId, number>(),
        /** Last engine status per model */
        statuses = new Map<ChatModelId, LlmStatus>(),
        /** Last failure per model */
        errors = new Map<ChatModelId, string>();
    let
        activeModel: ChatModel | undefined,
        status: LlmStatus = LlmStatus.idle,
        lastError: string | undefined,
        streaming: Promise<string | undefined> | undefined;

    const
        /** Whether wasm engine can run */
        wasmSupported = (): boolean =>
            (typeof window != `undefined`
                || typeof self != `undefined`
                || typeof Worker != `undefined`)
            && typeof WebAssembly != `undefined`,
        /** Whether WebGPU engine can run */
        webgpuSupported = (): boolean =>
            typeof navigator != `undefined`
            && !!(navigator as GpuNavigator).gpu
            && typeof WebAssembly != `undefined`,
        /** Engine choice per model */
        engineFor = (model: ChatModel): LlmEngine | undefined => {
            if (deps.backend == LlmBackend.none) return undefined;
            if (deps.backend == LlmBackend.cpu)
                return model.cpu ? cpuEngine : undefined;
            if (deps.backend == LlmBackend.gpu)
                return model.litert ? gpuEngine : undefined;
            if (model.litert && webgpuSupported()) return gpuEngine;
            if (model.cpu && wasmSupported()) return cpuEngine;
            return undefined;
        },
        /** Keep model cache across eviction */
        persistStorage = async () => {
            try {
                if (typeof navigator == `undefined`) return;
                await navigator.storage?.persist?.();
            } catch { };
        },
        /** Loaded runtime of one model */
        runtimeFor = (model?: ChatModelId): LlmRuntime | undefined =>
            model
                ? runtimes.get(model)
                : activeModel
                    ? runtimes.get(activeModel.id)
                    : undefined,
        /** Set status read by snapshot */
        setStatus = (next: LlmStatus) => {
            status = next;
        },
        /** Drop loaded model, keep files */
        release = async (model: ChatModelId) => {
            const current = runtimes.get(model);
            if (!current) return;
            runtimes.delete(model);
            if (activeModel?.id == model)
                activeModel = [...runtimes.values()].pop()?.model;
            if (!runtimes.size && !loads.size) setStatus(LlmStatus.idle);
            await current.unload();
        },
        /** Release backend models; mobile, all */
        releaseBackend = async (backend: LlmBackend) => {
            for (const [model, current] of [...runtimes])
                if (mobile() || current.backend == backend)
                    await release(model);
        },
        /** Drop every loaded model */
        releaseAll = async () => {
            for (const model of [...runtimes.keys()]) await release(model);
        },
        /** Report progress to every waiter */
        reportProgress = (
            model: ChatModelId,
            value: number,
            phase?: LlmPhase,
        ) => {
            const next = {
                percent: Math.max(0, Math.min(1, value)),
                phase: phase || LlmPhase.download,
            };
            progress.set(model, next);
            for (const waiter of waiters.get(model) ?? [])
                waiter.report(next.percent, next.phase);
        },
        /** Stop an unwanted load */
        abortLoad = (model: ChatModelId) => {
            tokens.set(model, (tokens.get(model) ?? 0) + 1);
            aborts.get(model)?.abort();
            aborts.delete(model);
            // stopped load frees its slot
            const current = loads.get(model);
            if (current) settling.set(model, current);
            loads.delete(model);
            waiters.delete(model);
            progress.delete(model);
            statuses.set(model, LlmStatus.idle);
            // stopped load owns no status
            if (status == LlmStatus.downloading && !loads.size && !runtimes.size)
                setStatus(LlmStatus.idle);
        },
        /** Drop waiter, abort unclaimed load */
        releaseWaiter = (model: ChatModelId, waiter: RuntimeLoadWaiter) => {
            const list = waiters.get(model);
            if (list) waiters.set(model, list.filter(item => item != waiter));
            // caller may join same tick
            queueMicrotask(() => {
                if (!waiters.get(model)?.length && loads.has(model))
                    abortLoad(model);
            });
        },
        /** Follow load until caller leaves */
        followLoad = (
            model: ChatModelId,
            onProgress: RuntimeLoadParams[`onProgress`],
            signal?: AbortSignal,
        ): Promise<boolean> => {
            const current = loads.get(model);
            if (!current) return Promise.resolve(false);
            return new Promise<boolean>(resolve => {
                let settled = false;
                const
                    waiter: RuntimeLoadWaiter = {
                        report: onProgress,
                        settle: loaded => {
                            if (settled) return;
                            settled = true;
                            signal?.removeEventListener(`abort`, leave);
                            resolve(loaded);
                        },
                    },
                    leave = () => {
                        releaseWaiter(model, waiter);
                        waiter.settle(false);
                    },
                    list = waiters.get(model);
                if (list) list.push(waiter);
                else waiters.set(model, [waiter]);
                if (signal?.aborted) leave();
                else signal?.addEventListener(`abort`, leave, { once: true });
                void current.attempt.then(
                    waiter.settle,
                    () => waiter.settle(false),
                );
            });
        },
        /** Whether a model is loaded */
        ready = (model?: ChatModelId): boolean => !!runtimeFor(model),
        /** Load model or join load */
        load = async ({
            model,
            limits,
            assets,
            logging,
            signal,
            onProgress,
        }: RuntimeLoadParams): Promise<boolean> => {
            if (signal?.aborted) return false;
            if (runtimes.has(model.id)) {
                activeModel = model;
                return true;
            };
            if (loads.has(model.id)) {
                const current = progress.get(model.id);
                if (current) onProgress(current.percent, current.phase);
                return await followLoad(model.id, onProgress, signal);
            };
            const engine = engineFor(model);
            if (!engine) {
                const message = `Model is not supported on this device`;
                lastError = message;
                errors.set(model.id, message);
                statuses.set(model.id, LlmStatus.unsupported);
                setStatus(LlmStatus.unsupported);
                return false;
            };
            // one model per backend
            // another backend load may overlap
            const conflicts = [...loads.values(), ...settling.values()]
                .filter(load => mobile()
                    || engineFor(load.model)?.backend == engine.backend);
            for (const conflict of conflicts) abortLoad(conflict.model.id);
            const token = (tokens.get(model.id) ?? 0) + 1;
            tokens.set(model.id, token);
            const attempt = (async (): Promise<boolean> => {
                // replaced builds release before takeover
                await Promise.all(conflicts.map(load =>
                    load.attempt.catch(() => false)));
                if (token != tokens.get(model.id)) return false;
                await persistStorage();
                if (token != tokens.get(model.id)) return false;
                // a backend holds one model
                await releaseBackend(engine.backend);
                if (token != tokens.get(model.id)) return false;
                const cached = await engine.cached(model);
                if (token != tokens.get(model.id)) return false;
                lastError = undefined;
                errors.delete(model.id);
                statuses.set(model.id, LlmStatus.downloading);
                setStatus(LlmStatus.downloading);
                reportProgress(model.id, 0, LlmPhase.download);
                // cached model loads without download
                if (cached) reportProgress(model.id, 1, LlmPhase.load);
                const controller = new AbortController();
                aborts.set(model.id, controller);
                try {
                    const started = await engine.startLLM({
                        model,
                        limits,
                        logging,
                        signal: controller.signal,
                        assets,
                        // only current attempt reports progress
                        onProgress: (value, phase) => {
                            if (token == tokens.get(model.id))
                                reportProgress(model.id, value, phase);
                        },
                    });
                    if (token != tokens.get(model.id) || controller.signal.aborted) {
                        await started.unload();
                        return false;
                    };
                    runtimes.set(model.id, started);
                    activeModel = model;
                    lastError = undefined;
                    errors.delete(model.id);
                    statuses.set(model.id, LlmStatus.ready);
                    setStatus(LlmStatus.ready);
                    reportProgress(model.id, 1, LlmPhase.load);
                    return true;
                } catch (error) {
                    if (token != tokens.get(model.id)) return false;
                    const message = `${(error as Error)?.message || `${error}`}`;
                    lastError = message;
                    errors.set(model.id, message);
                    statuses.set(model.id, LlmStatus.error);
                    setStatus(LlmStatus.error);
                    if (logging) console.log(`Local model failed`, error);
                    return false;
                } finally {
                    if (aborts.get(model.id) == controller)
                        aborts.delete(model.id);
                };
            })();
            let entry: RuntimeLoad | undefined;
            const wrapped = attempt.finally(() => {
                if (settling.get(model.id) == entry)
                    settling.delete(model.id);
                if (loads.get(model.id) != entry) return;
                loads.delete(model.id);
                waiters.delete(model.id);
                progress.delete(model.id);
            });
            entry = { model, attempt: wrapped };
            loads.set(model.id, entry);
            waiters.set(model.id, []);
            return await followLoad(model.id, onProgress, signal);
        },
        /** Release one model or all */
        unload = async (model?: ChatModelId) => {
            if (model) {
                await release(model);
                return;
            };
            for (const id of [...loads.keys()]) abortLoad(id);
            progress.clear();
            statuses.clear();
            errors.clear();
            lastError = undefined;
            setStatus(LlmStatus.idle);
            await releaseAll();
        },
        /** Release all, delete cached files */
        clear = async () => {
            const pending = [...loads.values(), ...settling.values()]
                .map(load => load.attempt);
            await unload();
            await Promise.all(pending.map(attempt =>
                attempt.catch(() => undefined)));
            await Promise.all([cpuEngine.purge(), gpuEngine.purge()]);
        },
        /** Run one chat completion */
        chat = async (params: RuntimeChatParams): Promise<string | undefined> => {
            if (!runtimeFor(params.model)) return undefined;
            // one turn at a time
            while (streaming) await streaming.catch(() => undefined);
            const runtime = runtimeFor(params.model);
            if (!runtime) return undefined;
            if (activeModel?.id != runtime.model.id) activeModel = runtime.model;
            const turn = runtime.chat(params);
            streaming = turn;
            try {
                return await turn;
            } finally {
                if (streaming == turn) streaming = undefined;
            };
        },
        /** Whether a load is pending */
        isLoading = (model?: ChatModelId): boolean =>
            model ? loads.has(model) : loads.size > 0;

    return {
        load,
        chat,
        unload,
        clear,
        ready,
        loading: isLoading,
        status: (model?: ChatModelId): LlmStatus => {
            if (runtimeFor(model)) return LlmStatus.ready;
            if (!model) return status;
            if (loads.has(model))
                return statuses.get(model) ?? LlmStatus.downloading;
            if (errors.has(model))
                return statuses.get(model) ?? LlmStatus.error;
            return LlmStatus.idle;
        },
        backend: (model?: ChatModelId): LlmBackend =>
            runtimeFor(model)?.backend ?? LlmBackend.none,
        /** Last load error per model */
        error: (model?: ChatModelId): string | undefined =>
            model ? errors.get(model) : lastError,
        model: () => activeModel,
    };
};

const runtime = createRuntime();

export { createRuntime, runtime };
