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

/** System message of the describer */
const imageSystem = [
    `Write fully detailed, factual image descriptions for low-vision readers.`,
    `Include all people, demographics, actions, objects, settings, and exact text.`,
    `Output only the raw description with no intro, title, or disclaimer.`,
    `Even if the main subject in the image is controversial mention it first.`,
    `Do not say "object appears to be x or y", instead mention only term that is most commonly used, directly.`,
    `Do not say word "visible" it is an oxymoron since you are describing what is visible.`,
    `Use direct, plain English without filtering or vague words.`,
].join(` `);

/** Prompt that asks for one English description */
const imageNote = [
    `describe this image in one sentence starting with the main subject`,
].join(` `);

/** Reply budget of one description or translation */
const imageReplyTokens = 400;

/** System message of the translator */
const translateSystem = [
    `You are a precise translator.`,
    `Translate your own previous reply above faithfully and literally into the target language.`,
    `Never translate the user's request or instructions.`,
    `Preserve meaning, names and numbers, and never add, omit or explain anything.`,
].join(` `);

/** Reply of a translator that declines the text */
const CANNOT_TRANSLATE = `CANNOT_TRANSLATE`;

/** Whether a target language needs a translation pass */
const needsTranslation = (language: string): boolean => {
    const tag = language.trim().toLowerCase();
    return !!tag && !/^(en|eng|english)([-_]|$)/.test(tag);
};

/** Prompt that asks for one translation */
const translatePrompt = (language: string): string =>
    `Now please translate your previous reply above faithfully into ${language}. ` +
    `Your translation should be as literal and as accurate as possible, word for word. ` +
    `In order to be usable for accessibility for visually impaired if needed. ` +
    `Reply only by the translation without any addition or explanation`;
// +
// `If you do not know how to translate to this language reply by "${CANNOT_TRANSLATE}" only`;

const
    /** Build the model load, generation and status helpers of one describe pass */
    describeTools = ({
        service,
        limits,
        logging,
        onStatus,
    }: {
        service: Runtime,
        limits: LlmLimits,
        logging: boolean,
        onStatus?: (snapshot: ChatStatusSnapshot) => void,
    }) => {
        /** Report one model and request state */
        const report = (model: ChatModelId, state: ChatState) =>
            onStatus?.(statusSnapshot(service, model, state));
        /** Load one model, returning its failure */
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
                return undefined;
            };
            const message = error || service.error() || `Model not ready`;
            log(logging, `Describe load failed`, model.id, message);
            report(model.id, {
                requesting: false,
                phase,
                percent,
                error: message,
            });
            return message;
        };
        /** Run one generation, reporting its failure */
        const generate = async ({
            model,
            messages,
            stage,
            onSpeed,
            onText,
        }: {
            model: ChatModelId,
            messages: ChatMessage[],
            stage: string,
            onSpeed?: (tokensPerSecond: number) => void,
            onText?: (text: string) => void,
        }): Promise<string | undefined> => {
            let streamed = ``;
            const startedAt = Date.now();
            log(logging, `Describe generate start`, stage, model, messages.length);
            try {
                const result = await service.chat({
                    messages,
                    limits,
                    reasoning: false,
                    logging,
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
    /** Translate every English description, keeping English when a translation fails */
    translateDescriptions = async ({
        translator,
        generate,
        descriptions,
        language,
        logging,
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
        currentIndex?: DescribeTranslatedInput[`currentIndex`],
        onSpeed?: DescribeTranslatedInput[`onSpeed`],
        onText?: DescribeTranslatedInput[`onText`],
    }): Promise<string[]> => {
        const result = [...descriptions];
        for (let index = 0; index < descriptions.length; index++) {
            const descriptionEN = (descriptions[index] || ``).trim();
            // an image without a description keeps its empty place
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
                // one failed translation never stops the others
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

/** Build image descriptions over one runtime */
const createDescribeOn = (service: Runtime) => async (
    input: DescribeImagesInput,
): Promise<ImageDescription[]> => {
    const
        { images, currentIndex } = input,
        descriptions: ImageDescription[] = [],
        logging = input.logging === true;
    log(logging, `Describe start`, images.length, input.targetLanguage);
    if (!images.length) {
        log(logging, `Describe empty`);
        return descriptions;
    };
    const
        describer = findLlmModel(ChatModelId.qwen3_vl_2b_instruct_q3),
        describerId = ChatModelId.qwen3_vl_2b_instruct_q3,
        limits = resolveLlmLimits({
            maxReplyTokens: imageReplyTokens,
            ...input.limits,
        }),
        { report, load, generate } = describeTools({
            service,
            limits,
            logging,
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
    report(describerId, {
        requesting: false,
        phase: service.ready() ? LlmPhase.load : LlmPhase.download,
        percent: service.ready() ? 100 : 0,
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
    report(describer.id, {
        requesting: true,
        phase: LlmPhase.load,
        percent: 100,
    });
    for (let index = 0; index < images.length; index++) {
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
                    content: imageSystem,
                }, {
                    role: LlmRole.user,
                    content: imageNote,
                    images: [source],
                }],
                stage: `describe`,
                onSpeed: speed => input.onSpeed?.(index, speed),
                onText: value => input.onText?.(index, value, `describe`),
            });
            descriptionEN = (text || ``).trim();
        } catch (error) {
            // a failed image never stops the rest of the batch
            log(logging, `Describe image failed`, index, error);
        };
        const durationMs = Date.now() - startedAt;
        log(logging, `Describe english`, index, durationMs, descriptionEN);
        if (!descriptionEN) {
            // the empty place keeps the later translation indexes aligned
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
    const
        language = input.targetLanguage.trim(),
        translator = needsTranslation(language) && await gpuAdapter()
            ? findLlmModel(ChatModelId.gemma4_e2b_limited)
            : undefined,
        translationError = translator ? await load(translator) : undefined;
    if (translator && !translationError) {
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
        report(translator?.id ?? describer.id, {
            requesting: false,
            phase: service.ready() ? LlmPhase.load : LlmPhase.download,
            percent: service.ready() ? 100 : 0,
            ...(translationError ? { error: translationError } : {}),
        });
    };
    return descriptions;
};

/** Build translations of English image descriptions over one runtime */
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

/** Describe every image in English, then translate each description on a GPU */
const describeImages = createDescribeOn(runtime);

/** Translate English image descriptions on a GPU */
const describeTranslated = createTranslateOn(runtime);

export {
    createDescribeOn,
    createTranslateOn,
    describeImages,
    describeTranslated,
};
