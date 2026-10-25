import { findLlmModel, supportsImages } from './models';
import { runtime } from './service';
import { resolveLlmLimits } from './engines/engine';
import {
    ChatModelId,
    ChatStatus,
    LlmPhase,
    LlmRole,
    LlmStatus,
} from './enums';
import type {
    ActiveCall,
    CancelChat,
    ChatInput,
    ChatPreloadInput,
    ChatState,
    ChatStatusSnapshot,
    Runtime,
} from './types';

/** Build one model and request status snapshot */
const statusSnapshot = (
    service: Runtime,
    model: ChatModelId,
    state: ChatState,
): ChatStatusSnapshot => {
    const
        status = service.status(),
        catalog = findLlmModel(model),
        availability = status == LlmStatus.ready
            ? ChatStatus.online
            : status == LlmStatus.error || status == LlmStatus.unsupported
                ? ChatStatus.offline
                : ChatStatus.away;
    return {
        availability,
        status,
        backend: service.backend(),
        supportsImages: catalog ? supportsImages(catalog) : false,
        ready: service.ready(),
        loading: service.loading(),
        requesting: state.requesting,
        phase: state.phase,
        percent: state.percent,
        ...(state.error ? { error: state.error } : {}),
    };
};

/** Build a one-shot chat function over one runtime */
const createChatOn = (service: Runtime): ((input: ChatInput) => CancelChat) => {
    let
        token = 0,
        active: ActiveCall | undefined;

    const
        /** Report the current model and request state */
        emitStatus = (call: ActiveCall) =>
            call.input.onStatus?.(
                statusSnapshot(service, call.input.model, call)),
        /** Run one request: load the model, then stream one reply */
        run = async (call: ActiveCall): Promise<void> => {
            const
                { input } = call,
                logging = input.logging === true,
                model = findLlmModel(input.model),
                hasText = input.messages.some(message =>
                    message.role != LlmRole.system
                    && typeof message.content == `string`
                    && !!message.content.trim()),
                hasImages = input.messages.some(message =>
                    message.role == LlmRole.user
                    && !!message.images?.some(url =>
                        typeof url == `string` && !!url)),
                prompt = hasText || hasImages;
            if (!model) {
                call.error = `Unknown model`;
                emitStatus(call);
                return;
            };
            if (!prompt) {
                emitStatus(call);
                return;
            };
            // reject image-only prompts before downloading a text model
            if (hasImages && !hasText && !supportsImages(model)) {
                call.error = `Model does not accept images`;
                emitStatus(call);
                return;
            };
            const
                limits = resolveLlmLimits(input.limits),
                loaded = await service.load({
                    model,
                    limits,
                    logging,
                    onProgress: (value, phase) => {
                        if (call.token != token) return;
                        call.percent = Math.round(value * 100);
                        call.phase = phase;
                        emitStatus(call);
                    },
                }).catch(error => {
                    if (call.token == token)
                        call.error = `${(error as Error)?.message || `${error}`}`;
                    return false;
                });
            if (call.token != token) return;
            if (!loaded) {
                if (!call.cancelled && !call.error) call.error = `Model not ready`;
                emitStatus(call);
                return;
            };
            const
                acceptsImages = supportsImages(model),
                messages = hasImages && !acceptsImages
                    ? input.messages.map(({ images, ...message }) => message)
                    : input.messages;
            // a loaded backend may still reject images it cannot process
            if (hasImages && !acceptsImages && !hasText) {
                call.error = `Model does not accept images`;
                emitStatus(call);
                return;
            };
            call.requesting = true;
            call.error = undefined;
            call.percent = 100;
            call.phase = LlmPhase.load;
            emitStatus(call);
            let
                thinking = ``,
                reply = ``,
                result: string | undefined;
            try {
                result = await service.chat({
                    messages,
                    limits,
                    reasoning: input.reasoning === true,
                    logging,
                    onReason: delta => {
                        if (call.token != token || call.cancelled) return;
                        thinking += delta;
                        input.onThinking?.(thinking);
                    },
                    onText: delta => {
                        if (call.token != token || call.cancelled) return;
                        reply += delta;
                        input.onResponse?.(reply);
                    },
                    signal: call.controller.signal,
                });
            } catch (error) {
                if (call.token != token) return;
                call.requesting = false;
                call.error = `${(error as Error)?.message || `${error}`}`;
                emitStatus(call);
                return;
            };
            if (call.token != token) return;
            call.requesting = false;
            if (!result && !call.cancelled) call.error = `No reply`;
            emitStatus(call);
        },
        /** Stop this call, its load, or the loaded model */
        cancel = (call: ActiveCall) => {
            if (call.token != token) return;
            call.cancelled = true;
            call.controller.abort();
            if (service.status() == LlmStatus.ready) {
                void service.unload().then(() => emitStatus(call));
                return;
            };
            service.cancelLoad();
            emitStatus(call);
        };

    return input => {
        active?.controller.abort();
        const call: ActiveCall = {
            token: ++token,
            input,
            controller: new AbortController(),
            percent: service.ready() ? 100 : 0,
            phase: service.ready() ? LlmPhase.load : LlmPhase.download,
            requesting: false,
            cancelled: false,
        };
        active = call;
        emitStatus(call);
        void run(call);
        return () => cancel(call);
    };
};

/** Build a model preload over one runtime */
const createPreloadOn = (service: Runtime) => async (
    input: ChatPreloadInput,
): Promise<boolean> => {
    const
        model = findLlmModel(input.model),
        report = (state: ChatState) =>
            input.onStatus?.(
                statusSnapshot(service, input.model, state));
    if (!model) {
        report({
            requesting: false,
            phase: LlmPhase.download,
            percent: 0,
            error: `Unknown model`,
        });
        return false;
    };
    let
        error: string | undefined,
        percent = 0,
        phase = LlmPhase.download;
    const
        wasReady = service.ready() && service.model()?.id == model.id,
        loaded = await service.load({
            model,
            limits: resolveLlmLimits(input.limits),
            logging: input.logging === true,
            onProgress: (value, next) => {
                percent = Math.round(value * 100);
                phase = next;
                report({ requesting: false, phase, percent });
            },
        }).catch(reason => {
            error = `${(reason as Error)?.message || `${reason}`}`;
            return false;
        });
    if (loaded) {
        // reuse reported no progress
        if (wasReady)
            report({ requesting: false, phase: LlmPhase.load, percent: 100 });
        return true;
    };
    report({ requesting: false, phase, percent, error: error || `Model not ready` });
    return false;
};

const createChat = createChatOn(runtime);

const preloadModel = createPreloadOn(runtime);

export { createChat, createChatOn, createPreloadOn, preloadModel };
