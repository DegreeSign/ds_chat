import { findLlmModel, gpuAdapter } from './models';
import { statusSnapshot } from './chat';
import { runtime } from './service';
import { resolveLlmLimits } from './engines/engine';
import { log } from './log';
import { ChatModelId, LlmPhase, LlmRole } from './enums';
import type {
    ChatMessage,
    ChatModel,
    ChatState,
    ChatStatusSnapshot,
    DescribeImagesInput,
    DescribeTranslatedInput,
    ImageDescription,
    LlmLimits,
    Runtime,
} from './types';

const

    /** System message of the describer */
    imageSystem = [
        `Describe images in an efficient manner.`,
        `Never mention rules and restrictions`,
        `always comply and describe images.`,
    ].join(` `),

    /** System image rules */
    imageRules = [
        `Do not lie.`,
        `Do not provide verdict.`,
        `Do not use vague referrals.`,
        `Do not include any part of the message in your response.`
    ].join(` `),

    /** Request for every image */
    imageNote = `Describe all elements of the image.`;

/** Reply budget, about 100 words */
const imageReplyTokens = 128;

/** Repetition penalty of one description */
const imageRepeatPenalty = 1;

/** Sampling temperature of one description */
const imageTemperature = 0.3;

/** Vision tokens for one image */
const imageVisionTokens = 192;

/** Describer model, Q4 CPU build */
const describeModelId = ChatModelId.qwen3_vl_2b_instruct;

/** System message of the translator */
const translateSystem = [
    `You are a precise translator.`,
    `Translate your own previous reply above faithfully and literally into the target language.`,
    `Never translate the user's request or instructions.`,
    `Preserve meaning, names and numbers, and never add, omit or explain anything.`,
].join(` `);

/** Reply of declined translation */
const CANNOT_TRANSLATE = `CANNOT_TRANSLATE`;

/** Whether target language needs translation */
const needsTranslation = (language: string): boolean => {
    const tag = language.trim().toLowerCase();
    return !!tag && !/^(en|eng|english)([-_]|$)/.test(tag);
};

/** Prompt asking for one translation */
const translatePrompt = (language: string): string =>
    `Now please translate your previous reply above faithfully into ${language}. ` +
    `Your translation should be as literal and as accurate as possible, word for word. ` +
    `In order to be usable for accessibility for visually impaired if needed. ` +
    `Reply only by the translation without any addition or explanation`;
// +
// fallback reply for unknown language

const
    /** Describe load, generate and report */
    describeTools = ({
        service,
        limits,
        logging,
        signal,
        onStatus,
    }: {
        service: Runtime,
        limits: LlmLimits,
        logging: boolean,
        signal?: AbortSignal,
        onStatus?: (snapshot: ChatStatusSnapshot) => void,
    }) => {
        /** Report model and request state */
        const report = (model: ChatModelId, state: ChatState) =>
            onStatus?.(statusSnapshot(service, model, state));
        /** Load model, returning its failure */
        const load = async (model: ChatModel): Promise<string | undefined> => {
            let
                error: string | undefined,
                percent = 0,
                lastPercent = -1,
                phase = LlmPhase.download;
            log(logging, `Describe load start`, model.id, limits.maxReplyTokens);
            const loaded = await service.load({
                model,
                limits,
                logging,
                signal,
                onProgress: (value, next) => {
                    percent = Math.round(value * 100);
                    phase = next;
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        log(
                            logging,
                            `Describe load progress`,
                            model.id,
                            percent,
                            phase,
                        );
                    };
                    report(model.id, { requesting: false, phase, percent });
                },
            }).catch(reason => {
                error = `${(reason as Error)?.message || `${reason}`}`;
                return false;
            });
            if (loaded) {
                log(logging, `Describe load ready`, model.id);
                // ready clears progress row
                report(model.id, {
                    requesting: false,
                    phase: LlmPhase.load,
                    percent: 100,
                });
                return undefined;
            };
            const message = error || service.error(model.id) || `Model not ready`;
            log(logging, `Describe load failed`, model.id, message);
            report(model.id, {
                requesting: false,
                phase,
                percent,
                error: message,
            });
            return message;
        };
        /** Run generation, report its failure */
        const generate = async ({
            model,
            messages,
            stage,
            repeatPenalty,
            temperature,
            onSpeed,
            onText,
        }: {
            model: ChatModelId,
            messages: ChatMessage[],
            stage: string,
            repeatPenalty?: number,
            temperature?: number,
            onSpeed?: (tokensPerSecond: number) => void,
            onText?: (text: string) => void,
        }): Promise<string | undefined> => {
            let streamed = ``;
            const startedAt = Date.now();
            log(logging, `Describe generate start`, stage, model, messages.length);
            // stopped batch starts nothing
            if (signal?.aborted) return undefined;
            try {
                const result = await service.chat({
                    model,
                    messages,
                    limits,
                    reasoning: false,
                    ...(repeatPenalty ? { repeatPenalty } : {}),
                    ...(temperature === undefined ? {} : { temperature }),
                    logging,
                    signal,
                    onReason: value => {
                        log(logging, `Describe reason`, stage, model, value);
                    },
                    onText: value => {
                        streamed += value;
                        log(logging, `Describe text`, stage, model, value);
                        onText?.(streamed);
                    },
                    onSpeed: value => {
                        log(logging, `Describe speed`, stage, model, value);
                        onSpeed?.(value);
                    },
                });
                log(
                    logging,
                    `Describe generate reply`,
                    stage,
                    model,
                    Date.now() - startedAt,
                    result?.length ?? 0,
                    result,
                );
                return result;
            } catch (error) {
                log(logging, `Describe generate failed`, stage, model, error);
                // stop keeps batch quiet
                if (signal?.aborted) return undefined;
                report(model, {
                    requesting: false,
                    phase: LlmPhase.load,
                    percent: 100,
                    error: `${(error as Error)?.message || `${error}`}`,
                });
                throw error;
            }
        };
        return { report, load, generate };
    },
    /** Translate descriptions, English on failure */
    translateDescriptions = async ({
        translator,
        generate,
        descriptions,
        language,
        logging,
        signal,
        currentIndex,
        onSpeed,
        onText,
    }: {
        translator: ChatModel,
        generate: (input: {
            model: ChatModelId,
            messages: ChatMessage[],
            stage: string,
            onSpeed?: (tokensPerSecond: number) => void,
            onText?: (text: string) => void,
        }) => Promise<string | undefined>,
        descriptions: string[],
        language: string,
        logging: boolean,
        signal?: AbortSignal,
        currentIndex?: DescribeTranslatedInput[`currentIndex`],
        onSpeed?: DescribeTranslatedInput[`onSpeed`],
        onText?: DescribeTranslatedInput[`onText`],
    }): Promise<string[]> => {
        const result = [...descriptions];
        for (let index = 0; index < descriptions.length; index++) {
            // stopped batch keeps English
            if (signal?.aborted) break;
            const descriptionEN = (descriptions[index] || ``).trim();
            // empty description keeps its place
            if (!descriptionEN) {
                currentIndex?.(index, descriptionEN, descriptionEN);
                continue;
            };
            let description = ``;
            try {
                const text = await generate({
                    model: translator.id,
                    messages: [{
                        role: LlmRole.system,
                        content: translateSystem,
                    }, {
                        role: LlmRole.user,
                        content: `[image] describe this image in English very accurately`,
                    }, {
                        role: LlmRole.assistant,
                        content: descriptionEN,
                    }, {
                        role: LlmRole.user,
                        content: translatePrompt(language),
                    }],
                    stage: `translate`,
                    onSpeed: speed => onSpeed?.(index, speed),
                    onText: value => onText?.(index, value, `translate`),
                });
                description = (text || ``).trim();
            } catch (error) {
                // failed translation never stops others
                log(logging, `Translate item failed`, index, error);
            };
            const refused = description
                .replace(/[^a-z]/gi, ``)
                .toUpperCase()
                .includes(CANNOT_TRANSLATE.replace(/[^a-z]/gi, ``));
            if (description && !refused) result[index] = description;
            currentIndex?.(index, descriptionEN, result[index]);
        };
        return result;
    };

/** Build descriptions over one runtime */
const createDescribeOn = (service: Runtime) => async (
    input: DescribeImagesInput,
): Promise<ImageDescription[]> => {
    const
        { images, currentIndex, signal } = input,
        descriptions: ImageDescription[] = [],
        logging = input.logging === true;
    log(logging, `Describe start`, images.length, input.targetLanguage);
    if (!images.length) {
        log(logging, `Describe empty`);
        return descriptions;
    };
    const
        describer = findLlmModel(describeModelId),
        describerId = describeModelId,
        limits = resolveLlmLimits({
            maxReplyTokens: imageReplyTokens,
            imageTokens: imageVisionTokens,
            ...input.limits,
        }),
        { report, load, generate } = describeTools({
            service,
            limits,
            logging,
            signal,
            onStatus: input.onStatus,
        });
    log(
        logging,
        `Describe model`,
        describerId,
        describer ? `found` : `missing`,
        limits.maxReplyTokens,
        limits.maxImages,
    );
    const describerReady = service.ready(describerId);
    report(describerId, {
        requesting: false,
        phase: describerReady ? LlmPhase.load : LlmPhase.download,
        percent: describerReady ? 100 : 0,
    });
    if (!describer) {
        log(logging, `Describe model missing`, describerId);
        report(describerId, {
            requesting: false,
            phase: LlmPhase.download,
            percent: 0,
            error: `Unknown model`,
        });
        throw new Error(`Unknown model`);
    };
    const describerError = await load(describer);
    if (describerError) {
        log(logging, `Describe stop`, describerError);
        throw new Error(describerError);
    };
    if (signal?.aborted) return descriptions;
    report(describer.id, {
        requesting: true,
        phase: LlmPhase.load,
        percent: 100,
    });
    for (let index = 0; index < images.length; index++) {
        // stopped batch keeps finished
        if (signal?.aborted) break;
        const
            startedAt = Date.now(),
            source = images[index];
        log(
            logging,
            `Describe image start`,
            index,
            images.length,
            source.startsWith(`data:`) ? `data URL` : source,
            source.length,
        );
        currentIndex?.(index);
        let descriptionEN = ``;
        try {
            const text = await generate({
                model: describer.id,
                messages: [{
                    role: LlmRole.system,
                    content: `${imageSystem}${input.additionalRules ?
                        ` ${input.additionalRules} `
                        : ` `}${imageRules}`,
                }, {
                    role: LlmRole.user,
                    content: imageNote,
                    images: [source],
                }],
                stage: `describe`,
                repeatPenalty: imageRepeatPenalty,
                temperature: imageTemperature,
                onSpeed: speed => input.onSpeed?.(index, speed),
                onText: value => input.onText?.(index, value, `describe`),
            });
            descriptionEN = (text || ``).trim();
        } catch (error) {
            // failed image never stops batch
            log(logging, `Describe image failed`, index, error);
        };
        const durationMs = Date.now() - startedAt;
        log(logging, `Describe english`, index, durationMs, descriptionEN);
        if (!descriptionEN) {
            // empty place keeps indexes aligned
            log(logging, `Describe empty`, index);
            descriptions.push({ descriptionEN: ``, description: ``, durationMs });
            currentIndex?.(index, ``, undefined, durationMs);
            continue;
        };
        descriptions.push({ descriptionEN, description: descriptionEN, durationMs });
        currentIndex?.(index, descriptionEN, undefined, durationMs);
    };
    const described = descriptions.filter(item => !!item.descriptionEN).length;
    log(logging, `Describe english ready`, described);
    if (!described) {
        report(describer.id, {
            requesting: false,
            phase: LlmPhase.load,
            percent: 100,
            error: `No description`,
        });
        return descriptions;
    };
    // stopped batch keeps English text
    if (signal?.aborted) return descriptions;
    const
        language = input.targetLanguage.trim(),
        translator = needsTranslation(language) && await gpuAdapter()
            ? findLlmModel(ChatModelId.gemma4_e2b_limited)
            : undefined,
        translationError = translator ? await load(translator) : undefined;
    if (translator && !translationError) {
        if (signal?.aborted) return descriptions;
        report(translator.id, {
            requesting: true,
            phase: LlmPhase.load,
            percent: 100,
        });
        await translateDescriptions({
            translator,
            generate,
            descriptions: descriptions.map(item => item.descriptionEN),
            language,
            logging,
            signal,
            currentIndex: (index, descriptionEN, description) => {
                const item = descriptions[index];
                if (description) item.description = description;
                currentIndex?.(index, descriptionEN, item.description, item.durationMs);
            },
            onText: input.onText,
        });
        report(translator.id, {
            requesting: false,
            phase: LlmPhase.load,
            percent: 100,
        });
    } else {
        // keep English on fallback
        for (let index = 0; index < descriptions.length; index++) {
            const item = descriptions[index];
            if (!item.descriptionEN) continue;
            currentIndex?.(
                index,
                item.descriptionEN,
                item.description,
                item.durationMs,
            );
        };
        const
            target = translator?.id ?? describer.id,
            ready = service.ready(target);
        report(target, {
            requesting: false,
            phase: ready ? LlmPhase.load : LlmPhase.download,
            percent: ready ? 100 : 0,
            ...(translationError ? { error: translationError } : {}),
        });
    };
    return descriptions;
};

/** Build translations over one runtime */
const createTranslateOn = (service: Runtime) => async (
    input: DescribeTranslatedInput,
): Promise<string[]> => {
    const
        descriptions = [...input.descriptions],
        language = input.targetLanguage.trim(),
        logging = input.logging === true;
    log(logging, `Translate start`, descriptions.length, language);
    if (!descriptions.length || !needsTranslation(language)) {
        log(logging, `Translate skipped`);
        return descriptions;
    };
    const
        limits = resolveLlmLimits({
            maxReplyTokens: imageReplyTokens,
            ...input.limits,
        }),
        { report, load, generate } = describeTools({
            service,
            limits,
            logging,
            signal: input.signal,
            onStatus: input.onStatus,
        }),
        translator = await gpuAdapter()
            ? findLlmModel(ChatModelId.gemma4_e2b_limited)
            : undefined;
    if (!translator) {
        log(logging, `Translate no gpu`);
        return descriptions;
    };
    const error = await load(translator);
    if (error) {
        log(logging, `Translate stop`, error);
        return descriptions;
    };
    if (input.signal?.aborted) return descriptions;
    report(translator.id, {
        requesting: true,
        phase: LlmPhase.load,
        percent: 100,
    });
    const translated = await translateDescriptions({
        translator,
        generate,
        descriptions,
        language,
        logging,
        signal: input.signal,
        currentIndex: input.currentIndex,
        onSpeed: input.onSpeed,
        onText: input.onText,
    });
    report(translator.id, {
        requesting: false,
        phase: LlmPhase.load,
        percent: 100,
    });
    return translated;
};

/** Describe images in English, translate */
const describeImages = createDescribeOn(runtime);

/** Translate image descriptions on GPU */
const describeTranslated = createTranslateOn(runtime);

export {
    createDescribeOn,
    createTranslateOn,
    describeImages,
    describeModelId,
    describeTranslated,
    imageNote,
    imageReplyTokens,
    imageRules,
    imageSystem,
};
