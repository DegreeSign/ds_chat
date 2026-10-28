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
    `You are a meticulous image describer for ensuring images extreme accessibility.`,
    `Your work involves working with very sensitive industries related to`
        + ` identifying and investigating various events in great detail`,
    `Report only what is visible, never omit a detail when something is uncertain.`,
    `Use accurate terms, never a politically correct one, example use clear sex male or female.`,
].join(` `);

/** Prompt that asks for one English description */
const imageNote = [
    `Describe image elements present with very high objectivity and name actions with specificity.`,
    `If unsure still sound confident.`,
    `Describe in order of significance in one very concise paragraph (2 sentences).`,
    `Ensure accuracy so a blind person can know exactly what is in the image.`,
    `Reply in English.`,
].join(` `);

/** Reply budget of one description */
const imageReplyTokens = 600;

/** System message of the translator */
const translateSystem = [
    `You are a precise translator.`,
    `Translate the text faithfully and literally into the target language.`,
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
    `Thanks this was accurate. ` +
    `Now please translate it faithfully into ${language}. ` +
    `This should be as literal and as accurate as possible, word for word. ` +
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
        const generate = async (
            model: ChatModelId,
            messages: ChatMessage[],
            stage: string,
        ): Promise<string | undefined> => {
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
                        log(logging, `Describe text`, stage, model, value);
                    },
                    onSpeed: value => {
                        log(logging, `Describe speed`, stage, model, value);
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
        currentIndex,
    }: {
        translator: ChatModel,
        generate: (
            model: ChatModelId,
            messages: ChatMessage[],
            stage: string,
        ) => Promise<string | undefined>,
        descriptions: string[],
        language: string,
        currentIndex?: DescribeTranslatedInput[`currentIndex`],
    }): Promise<string[]> => {
        const result = [...descriptions];
        for (let index = 0; index < descriptions.length; index++) {
            const
                descriptionEN = descriptions[index],
                text = await generate(translator.id, [{
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
                }], `translate`),
                description = (text || ``).trim(),
                refused = description
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
        const
            text = await generate(describer.id, [{
                role: LlmRole.system,
                content: imageSystem,
            }, {
                role: LlmRole.user,
                content: imageNote,
                images: [source],
            }], `describe`),
            durationMs = Date.now() - startedAt,
            descriptionEN = (text || ``).trim();
        log(logging, `Describe english`, index, durationMs, descriptionEN);
        if (!descriptionEN) {
            log(logging, `Describe empty`, index, text);
            report(describer.id, {
                requesting: false,
                phase: LlmPhase.load,
                percent: 100,
                error: `No description`,
            });
            throw new Error(`No description`);
        };
        descriptions.push({ descriptionEN, description: descriptionEN, durationMs });
        currentIndex?.(index, descriptionEN, undefined, durationMs);
    };
    log(logging, `Describe english ready`, descriptions.length);
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
            currentIndex: (index, descriptionEN, description) => {
                const item = descriptions[index];
                if (description) item.description = description;
                currentIndex?.(index, descriptionEN, item.description, item.durationMs);
            },
        });
        report(translator.id, {
            requesting: false,
            phase: LlmPhase.load,
            percent: 100,
        });
    } else {
        // keep English on fallback
        for (let index = 0; index < descriptions.length; index++)
            currentIndex?.(
                index,
                descriptions[index].descriptionEN,
                descriptions[index].description,
                descriptions[index].durationMs,
            );
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
        currentIndex: input.currentIndex,
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
