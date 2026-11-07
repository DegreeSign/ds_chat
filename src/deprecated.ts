import {
    createDescribeImageOn,
    createDescriptionEnhancedOn,
} from './describe';
import { gpuAdapter } from './models';
import { runtime } from './service';
import { ChatModelId, DescriptionEnhancedStage } from './enums';
import type {
    DescribeImagesInput,
    DescribeTranslatedInput,
    ImageDescription,
    Runtime,
} from './types';

const
    /** Whether a language needs translation */
    translateNeeded = (language: string): boolean => {
        const tag = language.trim().toLowerCase();
        return !!tag && !/^(en|eng|english)([-_]|$)/.test(tag);
    },
    /** Build deprecated image batch over one runtime */
    createDescribeImagesOn = (service: Runtime) => {
        const
            describeOne = createDescribeImageOn(service),
            enhanceOne = createDescriptionEnhancedOn(service);
        /** @deprecated to be removed after Nov 2027 */
        return async (
            input: DescribeImagesInput,
        ): Promise<ImageDescription[]> => {
            let gpu: boolean | undefined;
            const
                results: ImageDescription[] = [],
                code = input.targetLanguage.trim() || `en`,
                /** Probe GPU once */
                hasGpu = async (): Promise<boolean> =>
                    gpu ??= await gpuAdapter();
            for (let index = 0; index < input.images.length; index++) {
                if (input.signal?.aborted) break;
                input.currentIndex?.(index);
                let descriptionEN = ``;
                const
                    startedAt = Date.now(),
                    image = input.images[index];
                try {
                    descriptionEN = await describeOne({
                        image,
                        systemRulesOverride: input.additionalRules,
                        signal: input.signal,
                        limits: input.limits,
                        logging: input.logging,
                        onStatus: input.onStatus,
                        onSpeed: speed => input.onSpeed?.(index, speed),
                        onText: text => input.onText?.(index, text, `describe`),
                    });
                } catch { /* empty description keeps place */ };
                const durationMs = Math.max(0, Date.now() - startedAt);
                if (!descriptionEN) {
                    results.push({ descriptionEN: ``, description: ``, durationMs });
                    input.currentIndex?.(index, ``, undefined, durationMs);
                    continue;
                };
                input.currentIndex?.(index, descriptionEN, undefined, durationMs);
                let description = descriptionEN;
                if (translateNeeded(input.targetLanguage) && await hasGpu()) {
                    try {
                        const enhanced = await enhanceOne({
                            descriptionEN,
                            targetLanguage: input.targetLanguage,
                            targetCode: code,
                            withTags: false,
                            withDescription: true,
                            model: ChatModelId.gemma4_e2b_limited,
                            signal: input.signal,
                            limits: input.limits,
                            logging: input.logging,
                            onStatus: input.onStatus,
                            onSpeed: speed => input.onSpeed?.(index, speed),
                            onText: (text, stage) => {
                                if (stage != DescriptionEnhancedStage.translate)
                                    return;
                                input.onText?.(index, text, `translate`);
                            },
                        });
                        if (enhanced.translated) description = enhanced.description;
                    } catch { /* English kept on failure */ };
                };
                results.push({ descriptionEN, description, durationMs });
                input.currentIndex?.(index, descriptionEN, description, durationMs);
                if (input.signal?.aborted) break;
            };
            return results;
        };
    },
    /** Build deprecated translation batch over one runtime */
    createDescribeTranslatedOn = (service: Runtime) => {
        const enhanceOne = createDescriptionEnhancedOn(service);
        /** @deprecated to be removed after Nov 2027 */
        return async (
            input: DescribeTranslatedInput,
        ): Promise<string[]> => {
            const
                descriptions = [...input.descriptions],
                language = input.targetLanguage.trim(),
                code = language || `en`;
            // English needs no pass
            if (!descriptions.length || !translateNeeded(language))
                return descriptions;
            if (!await gpuAdapter()) return descriptions;
            for (let index = 0; index < descriptions.length; index++) {
                if (input.signal?.aborted) break;
                const descriptionEN = descriptions[index] || ``;
                // empty entry keeps its place
                if (!descriptionEN) {
                    input.currentIndex?.(index, descriptionEN, descriptionEN);
                    continue;
                };
                let description = descriptionEN;
                try {
                    const enhanced = await enhanceOne({
                        descriptionEN,
                        targetLanguage: language,
                        targetCode: code,
                        withTags: false,
                        withDescription: true,
                        model: ChatModelId.gemma4_e2b_limited,
                        signal: input.signal,
                        limits: input.limits,
                        logging: input.logging,
                        onStatus: input.onStatus,
                        onSpeed: speed => input.onSpeed?.(index, speed),
                        onText: (text, stage) => {
                            if (stage != DescriptionEnhancedStage.translate)
                                return;
                            input.onText?.(index, text, `translate`);
                        },
                    });
                    if (enhanced.translated) description = enhanced.description;
                } catch { /* English kept on failure */ };
                descriptions[index] = description;
                input.currentIndex?.(index, descriptionEN, description);
            };
            return descriptions;
        };
    },
    /** @deprecated to be removed after Nov 2027 */
    describeImages = createDescribeImagesOn(runtime),
    /** @deprecated to be removed after Nov 2027 */
    describeTranslated = createDescribeTranslatedOn(runtime);

export {
    createDescribeImagesOn,
    createDescribeTranslatedOn,
    describeImages,
    describeTranslated,
};
