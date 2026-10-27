import { findLlmModel, gpuAdapter } from './models';
import { statusSnapshot } from './chat';
import { runtime } from './service';
import { resolveLlmLimits } from './engines/engine';
import { ChatModelId, LlmPhase, LlmRole } from './enums';
import type {
    ChatMessage,
    ChatModel,
    ChatState,
    DescribeImagesInput,
    ImageDescription,
    LlmLimits,
    Runtime,
} from './types';

/** Prompt that asks for one English description */
const imageNote = [
    `Describe image elements present with very high objectivity and name actions with specificity.`,
    `If unsure still sound confident.`,
    `Describe in order of significance in one very concise paragraph (3 sentences).`,
    `Ensure accuracy so a blind person can know exactly what is in the image.`,
    `Reply in English.`,
].join(` `);

/** Reply budget of one description */
const imageReplyTokens = 1024;

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

/** Build image descriptions over one runtime */
const createDescribeOn = (service: Runtime) => async (
    input: DescribeImagesInput,
): Promise<ImageDescription[]> => {
    const
        { images, currentIndex } = input,
        descriptions: ImageDescription[] = [];
    if (!images.length) return descriptions;
    const
        describer = findLlmModel(ChatModelId.qwen3_vl_2b_instruct),
        describerId = ChatModelId.qwen3_vl_2b_instruct,
        limits = resolveLlmLimits({
            maxReplyTokens: imageReplyTokens,
            ...input.limits,
        }),
        /** Report one model and request state */
        report = (model: ChatModelId, state: ChatState) =>
            input.onStatus?.(statusSnapshot(service, model, state)),
        /** Load one model, returning its failure */
        load = async (
            model: ChatModel,
            budgets: LlmLimits,
        ): Promise<string | undefined> => {
            let
                error: string | undefined,
                percent = 0,
                phase = LlmPhase.download;
            const loaded = await service.load({
                model,
                limits: budgets,
                logging: input.logging,
                onProgress: (value, next) => {
                    percent = Math.round(value * 100);
                    phase = next;
                    report(model.id, { requesting: false, phase, percent });
                },
            }).catch(reason => {
                error = `${(reason as Error)?.message || `${reason}`}`;
                return false;
            });
            if (loaded) return undefined;
            const message = error || service.error() || `Model not ready`;
            report(model.id, {
                requesting: false,
                phase,
                percent,
                error: message,
            });
            return message;
        },
        /** Run one generation, reporting its failure */
        generate = async (
            model: ChatModelId,
            messages: ChatMessage[],
        ): Promise<string | undefined> => {
            try {
                return await service.chat({
                    messages,
                    limits,
                    reasoning: false,
                    logging: input.logging,
                    onReason: () => { },
                    onText: () => { },
                });
            } catch (error) {
                report(model, {
                    requesting: false,
                    phase: LlmPhase.load,
                    percent: 100,
                    error: `${(error as Error)?.message || `${error}`}`,
                });
                throw error;
            }
        };
    report(describerId, {
        requesting: false,
        phase: service.ready() ? LlmPhase.load : LlmPhase.download,
        percent: service.ready() ? 100 : 0,
    });
    if (!describer) {
        report(describerId, {
            requesting: false,
            phase: LlmPhase.download,
            percent: 0,
            error: `Unknown model`,
        });
        throw new Error(`Unknown model`);
    };
    const describerError = await load(describer, limits);
    if (describerError) throw new Error(describerError);
    report(describer.id, {
        requesting: true,
        phase: LlmPhase.load,
        percent: 100,
    });
    for (let index = 0; index < images.length; index++) {
        currentIndex?.(index);
        const text = await generate(describer.id, [{
            role: LlmRole.user,
            content: imageNote,
            images: [images[index]],
        }]);
        const descriptionEN = (text || ``).trim();
        if (!descriptionEN) {
            report(describer.id, {
                requesting: false,
                phase: LlmPhase.load,
                percent: 100,
                error: `No description`,
            });
            throw new Error(`No description`);
        };
        descriptions.push({ descriptionEN, description: descriptionEN });
        currentIndex?.(index, descriptionEN);
    };
    const
        language = input.targetLanguage.trim(),
        translator = needsTranslation(language) && await gpuAdapter()
            ? findLlmModel(ChatModelId.gemma4_e2b_limited)
            : undefined,
        translationError = translator
            ? await load(translator, resolveLlmLimits(input.limits, true))
            : undefined;
    if (translator && !translationError) {
        report(translator.id, {
            requesting: true,
            phase: LlmPhase.load,
            percent: 100,
        });
        for (let index = 0; index < descriptions.length; index++) {
            const
                item = descriptions[index],
                text = await generate(translator.id, [{
                    role: LlmRole.user,
                    content: `[image] describe this image in English very accurately`,
                }, {
                    role: LlmRole.assistant,
                    content: item.descriptionEN,
                }, {
                    role: LlmRole.user,
                    content: translatePrompt(language),
                }]),
                description = (text || ``).trim(),
                refused = description
                    .replace(/[^a-z]/gi, ``)
                    .toUpperCase()
                    .includes(CANNOT_TRANSLATE.replace(/[^a-z]/gi, ``));
            if (description && !refused) item.description = description;
            currentIndex?.(index, item.descriptionEN, item.description);
        };
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

/** Describe every image in English, then translate each description on a GPU */
const describeImages = createDescribeOn(runtime);

export { createDescribeOn, describeImages };
