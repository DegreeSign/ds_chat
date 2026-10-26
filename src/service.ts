import { llmModels } from './models';
import { litertEngine } from './engines/litert';
import { wllamaEngine } from './engines/wllama';
import { LlmBackend, LlmPhase, LlmStatus } from './enums';
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

const createRuntime = (deps: RuntimeDeps = {}): Runtime => {
    const
        /** The CPU engine this runtime can reach, real unless overridden */
        cpuEngine: LlmEngine = deps.engines?.cpu || wllamaEngine,
        /** The GPU engine this runtime can reach, real unless overridden */
        gpuEngine: LlmEngine = deps.engines?.litert || litertEngine;
    let
        runtime: LlmRuntime | undefined,
        activeModel: ChatModel | undefined,
        activeEngine: LlmEngine | undefined,
        backend: LlmBackend = LlmBackend.none,
        status: LlmStatus = LlmStatus.idle,
        loading: Promise<boolean> | undefined,
        loadingModel: ChatModel['id'] | undefined,
        waiters: RuntimeLoadWaiter[] = [],
        startAbort: AbortController | undefined,
        loadToken = 0,
        lastError: string | undefined,
        progress = { percent: 0, phase: LlmPhase.download },
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
        /** Remove every model except the one being loaded */
        evictPrevious = async (model: ChatModel, engine: LlmEngine) => {
            if (activeModel && activeModel.id != model.id) {
                const
                    previous = activeModel,
                    previousEngine = activeEngine,
                    current = runtime;
                runtime = undefined;
                activeModel = undefined;
                activeEngine = undefined;
                await current?.unload();
                await previousEngine?.remove(previous);
            };
            // skip a cold engine
            if (!await engine.hasCache()) return;
            for (const other of llmModels)
                if (other.id != model.id && engineFor(other) == engine)
                    await engine.remove(other);
        },
        /** Report load progress to every waiting caller */
        reportProgress = (value: number, phase?: LlmPhase) => {
            progress = {
                percent: Math.max(0, Math.min(1, value)),
                phase: phase || LlmPhase.download,
            };
            for (const waiter of [...waiters])
                waiter.report(progress.percent, progress.phase);
        },
        /** Set the engine status, read by the next status snapshot */
        setStatus = (next: LlmStatus) => {
            status = next;
        },
        /** Stop a download or load that is no longer wanted */
        abortLoad = () => {
            loadToken++;
            startAbort?.abort();
            startAbort = undefined;
            loadingModel = undefined;
            if (status == LlmStatus.downloading) setStatus(LlmStatus.idle);
        },
        /** Drop one caller, aborting the load once nobody waits for it */
        releaseWaiter = (waiter: RuntimeLoadWaiter) => {
            waiters = waiters.filter(item => item != waiter);
            // a newer caller may join in the same tick
            queueMicrotask(() => {
                if (!waiters.length && loading) abortLoad();
            });
        },
        /** Follow the in-flight load until it ends or this caller leaves */
        followLoad = (
            onProgress: RuntimeLoadParams[`onProgress`],
            signal?: AbortSignal,
        ): Promise<boolean> => {
            const attempt = loading;
            if (!attempt) return Promise.resolve(false);
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
                        releaseWaiter(waiter);
                        waiter.settle(false);
                    };
                waiters.push(waiter);
                if (signal?.aborted) leave();
                else signal?.addEventListener(`abort`, leave, { once: true });
                void attempt.then(waiter.settle, () => waiter.settle(false));
            });
        },
        /** Whether a model is loaded and ready for local chat */
        ready = (): boolean =>
            status == LlmStatus.ready && !!runtime && !!activeModel,
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
            if (ready() && activeModel?.id == model.id) return true;
            if (loading && loadingModel == model.id) {
                onProgress(progress.percent, progress.phase);
                return await followLoad(onProgress, signal);
            };
            if (loading) {
                // a different model wins, the old load lets go
                abortLoad();
                waiters = [];
                await loading.catch(() => false);
            };
            const token = ++loadToken;
            const attempt = (async (): Promise<boolean> => {
                await persistStorage();
                const engine = engineFor(model);
                if (token != loadToken) return false;
                if (!engine) {
                    lastError = `Model is not supported on this device`;
                    setStatus(LlmStatus.unsupported);
                    return false;
                };
                await evictPrevious(model, engine);
                if (token != loadToken) return false;
                const cached = await engine.cached(model);
                if (token != loadToken) return false;
                lastError = undefined;
                setStatus(LlmStatus.downloading);
                reportProgress(0, LlmPhase.download);
                // nothing to download, the model loads straight from the cache
                if (cached) reportProgress(1, LlmPhase.load);
                const controller = new AbortController();
                startAbort = controller;
                try {
                    const started = await engine.startLLM({
                        model,
                        limits,
                        logging,
                        signal: controller.signal,
                        assets,
                        // only the current attempt may report progress
                        onProgress: (value, phase) => {
                            if (token == loadToken) reportProgress(value, phase);
                        },
                    });
                    if (token != loadToken || controller.signal.aborted) {
                        await started.unload();
                        return false;
                    };
                    runtime = started;
                    activeModel = model;
                    activeEngine = engine;
                    backend = engine.backend;
                    lastError = undefined;
                    setStatus(LlmStatus.ready);
                    reportProgress(1, LlmPhase.load);
                    return true;
                } catch (error) {
                    if (token != loadToken) return false;
                    // Reset partial engine
                    runtime = undefined;
                    activeModel = undefined;
                    activeEngine = undefined;
                    lastError = `${(error as Error)?.message || `${error}`}`;
                    if (logging) console.log(`Local model failed`, error);
                    setStatus(LlmStatus.error);
                    return false;
                } finally {
                    if (startAbort == controller) startAbort = undefined;
                };
            })();
            const wrapped = attempt.finally(() => {
                if (loading == wrapped) {
                    loading = undefined;
                    loadingModel = undefined;
                    waiters = [];
                };
            });
            loading = wrapped;
            loadingModel = model.id;
            return await followLoad(onProgress, signal);
        },
        /** Release the local model from memory, keeping its cache */
        unload = async () => {
            const current = runtime;
            abortLoad();
            runtime = undefined;
            activeModel = undefined;
            activeEngine = undefined;
            setStatus(LlmStatus.idle);
            await current?.unload();
        },
        /** Run one chat completion on the loaded runtime */
        chat = async (params: RuntimeChatParams): Promise<string | undefined> => {
            if (!ready() || !runtime) return undefined;
            // the engine takes one turn at a time
            while (streaming) await streaming.catch(() => undefined);
            if (!ready() || !runtime) return undefined;
            const current = runtime.chat(params);
            streaming = current;
            try {
                return await current;
            } finally {
                if (streaming == current) streaming = undefined;
            };
        },
        /** Whether a model download or load is in flight */
        isLoading = (): boolean =>
            !ready() && status == LlmStatus.downloading;

    return {
        load,
        chat,
        unload,
        ready,
        loading: isLoading,
        status: () => status,
        backend: () => backend,
        /** Last model load error, cleared when a load starts */
        error: () => lastError,
        model: () => activeModel,
    };
};

const runtime = createRuntime();

export { createRuntime, runtime };
