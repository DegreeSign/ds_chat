import { findLlmModel, gpuAdapter } from './models';
import { runtime } from './service';
import { resolveLlmLimits } from './engines/engine';
import { ChatModelId, LlmRole } from './enums';
import type {
    DescribeImagesInput,
    ImageDescription,
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

/** Whether a target language needs a translation pass */
const needsTranslation = (language: string): boolean => {
    const tag = language.trim().toLowerCase();
    return !!tag && !/^(en|eng|english)([-_]|$)/.test(tag);
};

/** Prompt that asks for one translation */
const translatePrompt = (language: string, description: string): string =>
    `Translate the following English image description into ${language}. `
    + `Reply with the translation only.\n\n${description}`;

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
        limits = resolveLlmLimits({
            maxReplyTokens: imageReplyTokens,
            ...input.limits,
        });
    if (!describer) throw new Error(`Unknown model`);
    const loaded = await service.load({
        model: describer,
        limits,
        logging: input.logging,
        onProgress: () => { },
    });
    if (!loaded)
        throw new Error(service.error() || `Model not ready`);
    for (let index = 0; index < images.length; index++) {
        currentIndex?.(index);
        const text = await service.chat({
            messages: [{
                role: LlmRole.user,
                content: imageNote,
                images: [images[index]],
            }],
            limits,
            reasoning: false,
            logging: input.logging,
            onReason: () => { },
            onText: () => { },
        });
        const descriptionEN = (text || ``).trim();
        if (!descriptionEN) throw new Error(`No description`);
        descriptions.push({ descriptionEN, description: descriptionEN });
        currentIndex?.(index, descriptionEN);
    };
    const
        language = input.targetLanguage.trim(),
        translator = needsTranslation(language) && await gpuAdapter()
            ? findLlmModel(ChatModelId.gemma4_e2b_limited)
            : undefined,
        translated = !!translator && await service.load({
            model: translator,
            limits: resolveLlmLimits(input.limits, true),
            logging: input.logging,
            onProgress: () => { },
        });
    if (translated) {
        for (let index = 0; index < descriptions.length; index++) {
            const
                item = descriptions[index],
                text = await service.chat({
                    messages: [{
                        role: LlmRole.user,
                        content: translatePrompt(language, item.descriptionEN),
                    }],
                    limits,
                    reasoning: false,
                    logging: input.logging,
                    onReason: () => { },
                    onText: () => { },
                }),
                description = (text || ``).trim();
            if (description) item.description = description;
            currentIndex?.(index, item.descriptionEN, item.description);
        };
    } else {
        // keep English on fallback
        for (let index = 0; index < descriptions.length; index++)
            currentIndex?.(
                index,
                descriptions[index].descriptionEN,
                descriptions[index].description,
            );
    };
    return descriptions;
};

/** Describe every image in English, then translate each description on a GPU */
const describeImages = createDescribeOn(runtime);

export { createDescribeOn, describeImages };
