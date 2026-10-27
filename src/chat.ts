import {
    deviceModelId,
    findLlmModel,
    resolveLlmModel,
    supportsAudio,
    supportsImages,
} from './models';
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
    model: ChatModelId | undefined,
    state: ChatState,
): ChatStatusSnapshot => {
    const
        status = service.status(),
        effective = deviceModelId(model),
        catalog = findLlmModel(effective),
        availability = status == LlmStatus.ready
            ? ChatStatus.online
            : status == LlmStatus.error || status == LlmStatus.unsupported
                ? ChatStatus.offline
                : ChatStatus.away;
    return {
        ...(effective ? { model: effective } : {}),
        availability,
        status,
        backend: service.backend(),
        supportsImages: catalog ? supportsImages(catalog) : false,
        supportsAudio: catalog ? supportsAudio(catalog) : false,
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
                statusSnapshot(service, call.model ?? call.input.model, call)),
        /** Run one request: load the model, then stream one reply */
        run = async (call: ActiveCall): Promise<void> => {
            const
                { input } = call,
                logging = input.logging === true,
                model = await resolveLlmModel(input.model);
            call.model = model?.id;
            // newer call owns runtime
            if (call.token != token) return;
            const
                hasText = input.messages.some(message =>
                    message.role != LlmRole.system
                    && typeof message.content == `string`
                    && !!message.content.trim()),
                hasImages = input.messages.some(message =>
                    message.role == LlmRole.user
                    && !!message.images?.some(url =>
                        typeof url == `string` && !!url)),
                hasAudio = input.messages.some(message =>
                    message.role == LlmRole.user
                    && !!message.audio?.some(url =>
                        typeof url == `string` && !!url)),
                prompt = hasText || hasImages || hasAudio;
            if (!model) {
                call.error = `Unknown model`;
                emitStatus(call);
                return;
            };
            if (!prompt) {
                call.error = `No prompt`;
                emitStatus(call);
                return;
            };
            const
                acceptsImages = supportsImages(model),
                acceptsAudio = supportsAudio(model),
                keepsImages = hasImages && acceptsImages,
                keepsAudio = hasAudio && acceptsAudio;
            // reject media-only prompts before downloading a text model
            if (!hasText && !keepsImages && !keepsAudio) {
                if (hasAudio && !acceptsAudio)
                    call.error = `Model does not accept audio`;
                else if (hasImages && !acceptsImages)
                    call.error = `Model does not accept images`;
                emitStatus(call);
                return;
            };
            const
                limits = resolveLlmLimits(input.limits, !!model.litert),
                loaded = await service.load({
                    model,
                    limits,
                    logging,
                    signal: call.controller.signal,
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
            // a cancel reports the outcome itself
            if (call.cancelled) return;
            if (!loaded) {
                if (!call.error)
                    call.error = service.error() || `Model not ready`;
                emitStatus(call);
                return;
            };
            const
                messages = (hasImages && !acceptsImages)
                    || (hasAudio && !acceptsAudio)
                    ? input.messages.map(({ images, audio, ...message }) => ({
                        ...message,
                        ...(images && acceptsImages ? { images } : {}),
                        ...(audio && acceptsAudio ? { audio } : {}),
                    }))
                    : input.messages;
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
                    onSpeed: speed => {
                        if (call.token != token || call.cancelled) return;
                        input.onSpeed?.(speed);
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
            // a load another caller waits for keeps going
            queueMicrotask(() => emitStatus(call));
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
    input: ChatPreloadInput = {},
): Promise<boolean> => {
    const model = await resolveLlmModel(input.model);
    const report = (state: ChatState) =>
        input.onStatus?.(statusSnapshot(service, model?.id, state));
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
            limits: resolveLlmLimits(input.limits, !!model.litert),
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
    report({
        requesting: false,
        phase,
        percent,
        error: error || service.error() || `Model not ready`,
    });
    return false;
};

const createChat = createChatOn(runtime);

const preloadModel = createPreloadOn(runtime);

/** Delete every model file cached on this device */
const clearModelCache = async (): Promise<void> => {
    await runtime.clear();
};

export {
    clearModelCache,
    createChat,
    createChatOn,
    createPreloadOn,
    preloadModel,
};
