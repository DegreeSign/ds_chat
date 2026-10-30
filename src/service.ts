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
        /** The CPU engine this runtime can reach, real unless overridden */
        cpuEngine: LlmEngine = deps.engines?.cpu || wllamaEngine,
        /** The GPU engine this runtime can reach, real unless overridden */
        gpuEngine: LlmEngine = deps.engines?.litert || litertEngine,
        /** Whether this device keeps one model per backend, tests override */
        mobile = deps.mobile || mobileDevice,
        /** Every loaded model, one per backend on a desktop */
        runtimes = new Map<ChatModelId, LlmRuntime>(),
        /** Loads in flight, a desktop may run one per backend at a time */
        loads = new Map<ChatModelId, RuntimeLoad>(),
        /** Aborted loads that still unwind their engine work */
        settling = new Map<ChatModelId, RuntimeLoad>(),
        /** Callers waiting on the load of one model */
        waiters = new Map<ChatModelId, RuntimeLoadWaiter[]>(),
        /** Latest progress of one in-flight load */
        progress = new Map<ChatModelId, { percent: number, phase: LlmPhase }>(),
        /** Abort handle of one in-flight load */
        aborts = new Map<ChatModelId, AbortController>(),
        /** Last attempt of one model, a newer attempt invalidates the older */
        tokens = new Map<ChatModelId, number>(),
        /** Last engine status of one model */
        statuses = new Map<ChatModelId, LlmStatus>(),
        /** Last failure of one model, cleared when its next load starts */
        errors = new Map<ChatModelId, string>();
    let
        activeModel: ChatModel | undefined,
        status: LlmStatus = LlmStatus.idle,
        lastError: string | undefined,
        streaming: Promise<string | undefined> | undefined;

    const
        /** Whether this process can run the CPU (wasm) engine */
        wasmSupported = (): boolean =>
            (typeof window != `undefined`
                || typeof self != `undefined`
                || typeof Worker != `undefined`)
            && typeof WebAssembly != `undefined`,
        /** Whether this process can run the GPU (WebGPU) engine */
        webgpuSupported = (): boolean =>
            typeof navigator != `undefined`
            && !!(navigator as GpuNavigator).gpu
            && typeof WebAssembly != `undefined`,
        /** Pick the engine for one model, overridable by tests */
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
        /** Ask the browser to keep the model cache across eviction */
        persistStorage = async () => {
            try {
                if (typeof navigator == `undefined`) return;
                await navigator.storage?.persist?.();
            } catch { };
        },
        /** The runtime of one model, or the active one */
        runtimeFor = (model?: ChatModelId): LlmRuntime | undefined =>
            model
                ? runtimes.get(model)
                : activeModel
                    ? runtimes.get(activeModel.id)
                    : undefined,
        /** Set the engine status, read by the next status snapshot */
        setStatus = (next: LlmStatus) => {
            status = next;
        },
        /** Drop one loaded model, keeping its files */
        release = async (model: ChatModelId) => {
            const current = runtimes.get(model);
            if (!current) return;
            runtimes.delete(model);
            if (activeModel?.id == model)
                activeModel = [...runtimes.values()].pop()?.model;
            if (!runtimes.size && !loads.size) setStatus(LlmStatus.idle);
            await current.unload();
        },
        /** Drop every model of one backend, every model on a phone */
        releaseBackend = async (backend: LlmBackend) => {
            for (const [model, current] of [...runtimes])
                if (mobile() || current.backend == backend)
                    await release(model);
        },
        /** Drop every loaded model */
        releaseAll = async () => {
            for (const model of [...runtimes.keys()]) await release(model);
        },
        /** Report load progress to every waiting caller of one model */
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
        /** Stop a load that is no longer wanted */
        abortLoad = (model: ChatModelId) => {
            tokens.set(model, (tokens.get(model) ?? 0) + 1);
            aborts.get(model)?.abort();
            aborts.delete(model);
            // a stopped load leaves its slot at once, a new load may take it
            const current = loads.get(model);
            if (current) settling.set(model, current);
            loads.delete(model);
            waiters.delete(model);
            progress.delete(model);
            statuses.set(model, LlmStatus.idle);
            // a stopped load no longer owns the reported status
            if (status == LlmStatus.downloading && !loads.size && !runtimes.size)
                setStatus(LlmStatus.idle);
        },
        /** Drop one caller, aborting the load once nobody waits for it */
        releaseWaiter = (model: ChatModelId, waiter: RuntimeLoadWaiter) => {
            const list = waiters.get(model);
            if (list) waiters.set(model, list.filter(item => item != waiter));
            // a newer caller may join in the same tick
            queueMicrotask(() => {
                if (!waiters.get(model)?.length && loads.has(model))
                    abortLoad(model);
            });
        },
        /** Follow one in-flight load until it ends or this caller leaves */
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
        /** Whether a model is loaded and ready for local chat */
        ready = (model?: ChatModelId): boolean => !!runtimeFor(model),
        /** Load a model, or join a load of the same model already in flight */
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
            // a backend holds one model, a phone holds one model in total, so
            // only a load on another backend may keep running beside this one
            const conflicts = [...loads.values(), ...settling.values()]
                .filter(load => mobile()
                    || engineFor(load.model)?.backend == engine.backend);
            for (const conflict of conflicts) abortLoad(conflict.model.id);
            const token = (tokens.get(model.id) ?? 0) + 1;
            tokens.set(model.id, token);
            const attempt = (async (): Promise<boolean> => {
                // the replaced builds let go before this one takes the backend
                await Promise.all(conflicts.map(load =>
                    load.attempt.catch(() => false)));
                if (token != tokens.get(model.id)) return false;
                await persistStorage();
                if (token != tokens.get(model.id)) return false;
                // a backend holds one model, a phone holds one model in total
                await releaseBackend(engine.backend);
                if (token != tokens.get(model.id)) return false;
                const cached = await engine.cached(model);
                if (token != tokens.get(model.id)) return false;
                lastError = undefined;
                errors.delete(model.id);
                statuses.set(model.id, LlmStatus.downloading);
                setStatus(LlmStatus.downloading);
                reportProgress(model.id, 0, LlmPhase.download);
                // nothing to download, the model loads straight from the cache
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
                        // only the current attempt may report progress
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
        /** Release one loaded model, or every model */
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
        /** Release every model, then delete every cached model file */
        clear = async () => {
            const pending = [...loads.values(), ...settling.values()]
                .map(load => load.attempt);
            await unload();
            await Promise.all(pending.map(attempt =>
                attempt.catch(() => undefined)));
            await Promise.all([cpuEngine.purge(), gpuEngine.purge()]);
        },
        /** Run one chat completion on the model runtime */
        chat = async (params: RuntimeChatParams): Promise<string | undefined> => {
            if (!runtimeFor(params.model)) return undefined;
            // the engine takes one turn at a time
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
        /** Whether a model download or load is in flight */
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
        /** Last model load error, of one model or of the latest load */
        error: (model?: ChatModelId): string | undefined =>
            model ? errors.get(model) : lastError,
        model: () => activeModel,
    };
};

const runtime = createRuntime();

export { createRuntime, runtime };
