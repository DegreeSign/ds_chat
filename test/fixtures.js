// Shared fake engines for the verification suites.

/** Build one controllable engine, no model download and no wasm. */
const createFakeEngine = (options = {}) => {
    const
        backend = options.backend ?? `cpu`,
        calls = { start: 0, chat: 0, unload: 0, purge: 0, cached: 0 },
        models = [],
        limits = [],
        requests = [],
        loggings = [],
        engine = {
            backend,
            startLLM: async ({ model, limits: budgets, onProgress, signal, logging }) => {
                calls.start += 1;
                models.push(model);
                limits.push(budgets);
                loggings.push(logging);
                options.onStart?.(model);
                onProgress(0, `download`);
                if (options.loadGate)
                    await Promise.race([
                        options.loadGate,
                        new Promise(resolve =>
                            signal?.addEventListener(`abort`, resolve, { once: true })),
                    ]);
                if (signal?.aborted) throw new Error(`Cancelled`);
                if (options.failStart) throw new Error(`start failed`);
                onProgress(1, `load`);
                return {
                    model,
                    backend,
                    contextSize: 8192,
                    chat: async params => {
                        calls.chat += 1;
                        requests.push(params);
                        options.onChat?.(params);
                        if (options.chatImpl) return await options.chatImpl(params);
                        if (options.chatGate)
                            await Promise.race([
                                options.chatGate,
                                new Promise(resolve => params.signal?.addEventListener(
                                    `abort`,
                                    resolve,
                                    { once: true },
                                )),
                            ]);
                        if (params.signal?.aborted) return undefined;
                        if (options.failChat) throw new Error(`chat failed`);
                        if (options.thinkingText) {
                            const text = options.thinkingText,
                                half = Math.ceil(text.length / 2);
                            params.onReason(text.slice(0, half));
                            params.onReason(text.slice(half));
                        };
                        const text = options.chatText ?? `reply`,
                            half = Math.ceil(text.length / 2);
                        params.onText(text.slice(0, half));
                        params.onText(text.slice(half));
                        return text;
                    },
                    unload: async () => { calls.unload += 1; },
                };
            },
            cached: async () => {
                calls.cached += 1;
                return options.cached ?? true;
            },
            purge: async () => { calls.purge += 1; },
        };
    return { engine, calls, models, limits, requests, loggings };
};

module.exports = { createFakeEngine };
