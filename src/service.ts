import { llmModels } from './models';
import { wllamaEngine } from './engines/wllama';
import { LlmBackend, LlmPhase, LlmStatus } from './enums';
import type {
    ChatModel,
    LlmEngine,
    LlmRuntime,
    Runtime,
    RuntimeChatParams,
    RuntimeDeps,
    RuntimeLoadParams,
} from './types';

const createRuntime = (deps: RuntimeDeps = {}): Runtime => {
    const
        /** The CPU engine this runtime can reach, real unless overridden */
        cpuEngine: LlmEngine = deps.engines?.cpu || wllamaEngine;
    let
        runtime: LlmRuntime | undefined,
        activeModel: ChatModel | undefined,
        backend: LlmBackend = LlmBackend.none,
        status: LlmStatus = LlmStatus.idle,
        loading: Promise<boolean> | undefined,
        loadingModel: ChatModel['id'] | undefined,
        startAbort: AbortController | undefined,
        loadToken = 0,
        progress = { percent: 0, phase: LlmPhase.download },
        progressListener: RuntimeLoadParams[`onProgress`] | undefined,
        streaming: Promise<string | undefined> | undefined;

    const
        /** Whether this process can run the CPU (wasm) engine */
        wasmSupported = (): boolean =>
            (typeof window != `undefined`
                || typeof self != `undefined`
                || typeof Worker != `undefined`)
            && typeof WebAssembly != `undefined`,
        /** Pick the best available engine, overridable by tests */
        bestBackend = (): LlmBackend =>
            deps.backend
            || (wasmSupported() ? LlmBackend.cpu : LlmBackend.none),
        /** Delete every on-device model artifact */
        purgeModelCaches = async () => {
            await cpuEngine.purge();
        },
        /** Whether the browser reports the origin over its storage quota */
        isOverQuota = async (): Promise<boolean> => {
            try {
                if (typeof navigator == `undefined`) return false;
                if (!navigator.storage?.estimate) return false;
                const { quota = 0, usage = 0 } = await navigator.storage.estimate();
                return !!quota && usage >= quota;
            } catch { return false; };
        },
        /** Whether a failed load ran out of storage quota */
        isQuotaError = (error: unknown): boolean =>
            [`quota`, `no space`, `disk full`, `ns_error_dom_quota_reached`].some(part =>
                `${(error as Error)?.name || ``} ${(error as Error)?.message || `${error}`}`
                    .toLowerCase().includes(part)
            ),
        /** Ask the browser to keep the model cache across eviction */
        persistStorage = async () => {
            try {
                if (typeof navigator == `undefined`) return;
                await navigator.storage?.persist?.();
            } catch { };
        },
        /** Remove every model except the one being loaded */
        evictPrevious = async (model: ChatModel) => {
            if (activeModel && activeModel.id != model.id) {
                const
                    previous = activeModel,
                    current = runtime;
                runtime = undefined;
                activeModel = undefined;
                await current?.unload();
                await cpuEngine.remove(previous);
            };
            // skip a cold engine
            if (!await cpuEngine.hasCache()) return;
            for (const other of llmModels)
                if (other.id != model.id) await cpuEngine.remove(other);
        },
        /** Report load progress to the active request */
        reportProgress = (value: number, phase?: LlmPhase) => {
            progress = {
                percent: Math.max(0, Math.min(1, value)),
                phase: phase || LlmPhase.download,
            };
            progressListener?.(progress.percent, progress.phase);
        },
        /** Set the engine status, read by the next status snapshot */
        setStatus = (next: LlmStatus) => {
            status = next;
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
            onProgress,
        }: RuntimeLoadParams): Promise<boolean> => {
            if (ready() && activeModel?.id == model.id) return true;
            if (loading && loadingModel == model.id) {
                progressListener = onProgress;
                onProgress(progress.percent, progress.phase);
                return await loading;
            };
            if (loading) {
                // stop reporting the old model while it unwinds
                progressListener = undefined;
                startAbort?.abort();
                await loading.catch(() => false);
            };
            progressListener = onProgress;
            const token = ++loadToken;
            const attempt = (async (): Promise<boolean> => {
                await persistStorage();
                const which = bestBackend();
                if (token != loadToken) return false;
                if (which == LlmBackend.none) {
                    setStatus(LlmStatus.unsupported);
                    return false;
                };
                await evictPrevious(model);
                if (token != loadToken) return false;
                const cached = await cpuEngine.cached(model);
                if (token != loadToken) return false;
                // stale artifacts can push the origin over quota, clear them before downloading
                if (!cached && await isOverQuota()) await purgeModelCaches();
                if (token != loadToken) return false;
                setStatus(LlmStatus.downloading);
                reportProgress(0, LlmPhase.download);
                // nothing to download, the model loads straight from the cache
                if (cached) reportProgress(1, LlmPhase.load);
                const controller = new AbortController();
                startAbort = controller;
                try {
                    const started = await cpuEngine.startLLM({
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
                    backend = which;
                    setStatus(LlmStatus.ready);
                    reportProgress(1, LlmPhase.load);
                    return true;
                } catch (error) {
                    if (token != loadToken) return false;
                    // Reset partial engine
                    runtime = undefined;
                    activeModel = undefined;
                    if (logging) console.log(`Local model failed`, error);
                    // a download cut short by the browser quota leaves an unusable cache behind
                    if (isQuotaError(error)) await purgeModelCaches();
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
                };
            });
            loading = wrapped;
            loadingModel = model.id;
            return await wrapped;
        },
        /** Release the local model from memory, keeping its cache */
        unload = async () => {
            loadToken++;
            startAbort?.abort();
            startAbort = undefined;
            loadingModel = undefined;
            const current = runtime;
            runtime = undefined;
            activeModel = undefined;
            setStatus(LlmStatus.idle);
            await current?.unload();
        },
        /** Stop a download or load that is no longer wanted */
        cancelLoad = () => {
            loadToken++;
            startAbort?.abort();
            startAbort = undefined;
            loadingModel = undefined;
            if (status == LlmStatus.downloading) setStatus(LlmStatus.idle);
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
        cancelLoad,
        ready,
        loading: isLoading,
        status: () => status,
        backend: () => backend,
        model: () => activeModel,
    };
};

const runtime = createRuntime();

export { createRuntime, runtime };
