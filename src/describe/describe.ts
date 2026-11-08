import { findLlmModel, resolveLlmModel } from '../core/models';
import { statusSnapshot } from '../chat/chat';
import { runtime } from '../chat/service';
import { resolveLlmLimits } from '../engines/engine';
import { log } from '../core/log';
import { estimateReport, recordEstimate } from './estimate';
import {
    imageNote,
    imageSystem,
    nsfwTag,
    tagSystem,
    tagTranslateSystem,
    translatePreMessage,
    translatePrompt,
    translateSystem,
} from './prompts';
import {
    ChatModelId,
    DescriptionEnhancedStage,
    EstimateOperation,
    LlmPhase,
    LlmRole,
} from '../types/enums';
import type {
    ChatMessage,
    ChatModel,
    ChatState,
    ChatStatusSnapshot,
    DescribeImageInput,
    DescriptionEnhanced,
    DescriptionEnhancedInput,
    ImageTag,
    LlmLimits,
    Runtime,
    TranslateTagsInput,
} from '../types';

const
    /** Reply budget, about 100 words */
    imageReplyTokens = 128,
    /** Translation reply budget, doubled */
    imageTranslateTokens = imageReplyTokens * 2,
    /** Repetition penalty of one description */
    imageRepeatPenalty = 1,
    /** Sampling temperature of one description */
    imageTemperature = 0.1,
    /** Vision tokens for one image */
    imageVisionTokens = 192,
    /** Describer model, Q4 CPU build */
    describeModelId = ChatModelId.qwen3_vl_2b_instruct,
    /** Tags kept per image */
    imageTags = 3,
    /** Reply budget of one tag pass */
    tagReplyTokens = 128,
    /** Reply budget of one tag translation */
    tagTranslateTokens = imageTranslateTokens,
    /** Reply of declined translation */
    CANNOT_TRANSLATE = `CANNOT_TRANSLATE`,
    /** Whether target language needs translation */
    needsTranslation = (language: string): boolean => {
        const tag = language.trim().toLowerCase();
        return !!tag && !/^(en|eng|english)([-_]|$)/.test(tag);
    },
    /** Clean English tag word */
    cleanTag = (value?: string): string =>
        typeof value == `string`
            ? value.toLowerCase().replace(/[^a-z]+/g, ``).slice(0, 20)
            : ``,
    /** Clean translated tag word */
    cleanTagTranslation = (value?: string): string =>
        typeof value == `string`
            ? value.toLowerCase().replace(/[^\p{L}]+/gu, ``).slice(0, 20)
            : ``,
    /** Tags of one model reply */
    tagsOf = (reply: string): ImageTag[] => {
        const
            tags: ImageTag[] = [],
            /** Add one reply word */
            add = (value: string) => {
                const en = cleanTag(value);
                if (en.length < 2 || tags.some(tag => tag.en == en)) return;
                tags.push({ en });
            };
        for (const match of reply.matchAll(/^\s*\d+\s*[:.\-]\s*(.+)$/gm))
            for (const value of (match[1] || ``).split(/[,;\n]+/))
                for (const word of value.split(/\s+/)) add(word);
        // plain reply without numbers
        if (!tags.length)
            for (const value of reply.split(/[,;\n]+/))
                for (const word of value.split(/\s+/)) add(word);
        return tags
    },
    /** Fill translated tag words */
    translateTagWords = (
        reply: string,
        tags: ImageTag[],
        code: string,
    ): void => {
        // English tags stay untouched
        if (code == `en`) return;
        for (const match of reply.matchAll(/^\s*(\d+)\s*[:.\-]\s*(.+)$/gm)) {
            const
                tag = tags[Number(match[1]) - 1],
                word = cleanTagTranslation(match[2]);
            // English kept when missing
            if (!tag || !word || word == tag.en) continue;
            tag[code] = word;
        };
    },
    /** Resolve, load and prepare one call */
    prepareModel = async ({
        service,
        limits,
        logging,
        signal,
        onStatus,
        model,
    }: {
        service: Runtime,
        limits: LlmLimits,
        logging: boolean,
        signal?: AbortSignal,
        onStatus?: (snapshot: ChatStatusSnapshot) => void,
        model?: ChatModelId,
    }) => {
        const
            /** Report model and request state */
            report = (model: ChatModelId, state: ChatState) =>
                onStatus?.(statusSnapshot(service, model, state)),
            /** Load model, returning its failure */
            load = async (model: ChatModel): Promise<string | undefined> => {
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
            },
            /** Run generation, report its failure */
            generate = async ({
                model,
                messages,
                stage,
                repeatPenalty,
                temperature,
                limits: callLimits,
                onSpeed,
                onText,
            }: {
                model: ChatModelId,
                messages: ChatMessage[],
                stage: string,
                repeatPenalty?: number,
                temperature?: number,
                limits?: Partial<LlmLimits>,
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
                        limits: callLimits ? { ...limits, ...callLimits } : limits,
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
            },
            textModel = findLlmModel(model) ?? await resolveLlmModel();
        if (!textModel) {
            log(logging, `Model missing`, model);
            report(model || describeModelId, {
                requesting: false,
                phase: LlmPhase.download,
                percent: 0,
                error: `Unknown model`,
            });
            return { error: `Unknown model` };
        };
        const loadError = await load(textModel);
        if (loadError) return { error: loadError };
        if (signal?.aborted) return { aborted: true };
        report(textModel.id, {
            requesting: true,
            phase: LlmPhase.load,
            percent: 100,
        });
        return { report, generate, model: textModel };
    },
    /** Build image description over one runtime */
    createDescribeImageOn = (service: Runtime) => async (
        input: DescribeImageInput,
    ): Promise<string> => {
        const
            logging = input.logging === true,
            limits = resolveLlmLimits({
                maxReplyTokens: imageReplyTokens,
                imageTokens: imageVisionTokens,
                ...input.limits,
            });
        input.onEstimate?.(estimateReport([
            EstimateOperation.analyze,
            EstimateOperation.describe,
        ]));
        log(logging, `Describe image start`, input.image.length);
        const ready = await prepareModel({
            service,
            limits,
            logging,
            signal: input.signal,
            onStatus: input.onStatus,
            model: describeModelId,
        });
        if (`error` in ready) throw new Error(ready.error);
        if (`aborted` in ready) return ``;
        let
            firstTextAt: number | undefined,
            text = ``;
        const
            { report, generate, model: describer } = ready,
            startedAt = Date.now();
        try {
            text = (await generate({
                model: describer.id,
                messages: [{
                    role: LlmRole.system,
                    content: input.systemRulesOverride
                        || imageSystem,
                }, {
                    role: LlmRole.user,
                    content: imageNote,
                    images: [input.image],
                }],
                stage: `describe`,
                repeatPenalty: imageRepeatPenalty,
                temperature: imageTemperature,
                onSpeed: input.onSpeed,
                onText: value => {
                    firstTextAt ??= Date.now();
                    input.onText?.(value);
                },
            }) || ``).trim();
        } catch (error) {
            // stopped image stays silent
            if (input.signal?.aborted) return ``;
            throw error;
        };
        const endedAt = Date.now();
        log(logging, `Describe image done`, endedAt - startedAt, text);
        report(describer.id, {
            requesting: false,
            phase: LlmPhase.load,
            percent: 100,
        });
        if (!text) {
            log(logging, `Describe image empty`);
            report(describer.id, {
                requesting: false,
                phase: LlmPhase.load,
                percent: 100,
                error: `No description`,
            });
            return ``;
        };
        recordEstimate({
            operation: EstimateOperation.analyze,
            seconds: ((firstTextAt ?? endedAt) - startedAt) / 1000,
        });
        recordEstimate({
            operation: EstimateOperation.describe,
            seconds: (endedAt - (firstTextAt ?? startedAt)) / 1000,
        });
        return text;
    },
    /** Build tag translation over one runtime */
    createTranslateTagsOn = (service: Runtime) => async (
        input: TranslateTagsInput,
    ): Promise<ImageTag[]> => {
        const
            tags = input.tags.map(tag => ({ ...tag })),
            language = input.targetLanguage.trim(),
            code = input.targetCode.trim() || `en`,
            logging = input.logging === true;
        // English tags stay untouched
        if (!tags.length || code == `en` || !needsTranslation(language))
            return tags;
        input.onEstimate?.(estimateReport([
            EstimateOperation.translateTags,
        ]));
        const
            limits = resolveLlmLimits({
                maxReplyTokens: tagTranslateTokens,
                ...input.limits,
            }),
            ready = await prepareModel({
                service,
                limits,
                logging,
                signal: input.signal,
                onStatus: input.onStatus,
                model: input.model,
            });
        if (`error` in ready || `aborted` in ready) return tags;
        const
            { report, generate, model: textModel } = ready,
            startedAt = Date.now(),
            prompt = tags
                .map((tag, line) => `${line + 1}. ${tag.en}`)
                .join(`\n`);
        try {
            const reply = (await generate({
                model: textModel.id,
                messages: [{
                    role: LlmRole.system,
                    content: tagTranslateSystem(language),
                }, {
                    role: LlmRole.user,
                    content: prompt,
                }],
                stage: DescriptionEnhancedStage.translateTags,
                limits: { maxReplyTokens: tagTranslateTokens },
                onText: input.onText,
            }) || ``).trim();
            translateTagWords(reply, tags, code);
            recordEstimate({
                operation: EstimateOperation.translateTags,
                seconds: (Date.now() - startedAt) / 1000,
            });
        } catch (error) {
            // failed tag translation keeps English
            log(logging, `Enhance tag translate failed`, error);
        };
        report(textModel.id, {
            requesting: false,
            phase: LlmPhase.load,
            percent: 100,
        });
        return tags;
    },
    /** Build text enhancement over one runtime */
    createDescriptionEnhancedOn = (service: Runtime) => async (
        input: DescriptionEnhancedInput,
    ): Promise<DescriptionEnhanced> => {
        const
            descriptionEN = input.descriptionEN.trim(),
            language = input.targetLanguage.trim(),
            code = input.targetCode.trim() || `en`,
            withTags = input.withTags !== false,
            withDescription = input.withDescription !== false,
            logging = input.logging === true,
            translateTagsOn = createTranslateTagsOn(service),
            translate = !!descriptionEN
                && withDescription
                && code != `en`
                && needsTranslation(language),
            tagTranslate = withTags
                && code != `en`
                && needsTranslation(language),
            operations: EstimateOperation[] = [
                ...(translate ? [EstimateOperation.translate] : []),
                ...(withTags ? [EstimateOperation.tags] : []),
                ...(tagTranslate ? [EstimateOperation.translateTags] : []),
            ],
            result: DescriptionEnhanced = {
                description: descriptionEN,
                translated: false,
                tags: [],
                nsfw: undefined,
            };
        log(logging, `Enhance start`, descriptionEN.length, language, code);
        // empty text needs nothing
        if (!descriptionEN || !operations.length) return result;
        input.onEstimate?.(estimateReport(operations));
        const
            limits = resolveLlmLimits({
                maxReplyTokens: imageTranslateTokens,
                ...input.limits,
            }),
            ready = await prepareModel({
                service,
                limits,
                logging,
                signal: input.signal,
                onStatus: input.onStatus,
                model: input.model,
            });
        if (`error` in ready || `aborted` in ready) return result;
        const { report, generate, model: textModel } = ready;
        if (translate) {
            input.onStage?.(DescriptionEnhancedStage.translate);
            const startedAt = Date.now();
            try {
                const
                    text = await generate({
                        model: textModel.id,
                        messages: [{
                            role: LlmRole.system,
                            content: translateSystem,
                        }, {
                            role: LlmRole.user,
                            content: `[image] ${translatePreMessage}`,
                        }, {
                            role: LlmRole.assistant,
                            content: descriptionEN,
                        }, {
                            role: LlmRole.user,
                            content: translatePrompt(language),
                        }],
                        stage: DescriptionEnhancedStage.translate,
                        limits: { maxReplyTokens: imageTranslateTokens },
                        onSpeed: input.onSpeed,
                        onText: value => input.onText?.(
                            value,
                            DescriptionEnhancedStage.translate,
                        ),
                    }),
                    description = (text || ``).trim(),
                    refused = description
                        .replace(/[^a-z]/gi, ``)
                        .toUpperCase()
                        .includes(CANNOT_TRANSLATE.replace(/[^a-z]/gi, ``));
                if (description && !refused) {
                    result.description = description;
                    result.translated = true;
                };
                recordEstimate({
                    operation: EstimateOperation.translate,
                    seconds: (Date.now() - startedAt) / 1000,
                });
            } catch (error) {
                // failed translation keeps English
                log(logging, `Enhance translate failed`, error);
            };
        };
        if (withTags) {
            input.onStage?.(DescriptionEnhancedStage.tags);
            const startedAt = Date.now();
            try {
                const reply = (await generate({
                    model: textModel.id,
                    messages: [{
                        role: LlmRole.system,
                        content: tagSystem(imageTags),
                    }, {
                        role: LlmRole.user,
                        content: descriptionEN,
                    }],
                    stage: DescriptionEnhancedStage.tags,
                    limits: { maxReplyTokens: tagReplyTokens },
                    onSpeed: input.onSpeed,
                    onText: value => input.onText?.(
                        value,
                        DescriptionEnhancedStage.tags,
                    ),
                }) || ``).trim();
                const tags = tagsOf(reply);
                result.nsfw = tags.some(tag => tag.en == nsfwTag);
                result.tags = tags.filter(tag => tag.en != nsfwTag)
                    .slice(0, imageTags);
                recordEstimate({
                    operation: EstimateOperation.tags,
                    seconds: (Date.now() - startedAt) / 1000,
                });
                log(logging, `Enhance tags`, result.tags);
            } catch (error) {
                // failed tags keep flag unknown
                log(logging, `Enhance tags failed`, error);
            };
        };
        if (tagTranslate && result.tags.length) {
            input.onStage?.(DescriptionEnhancedStage.translateTags);
            result.tags = await translateTagsOn({
                tags: result.tags,
                targetLanguage: language,
                targetCode: code,
                model: textModel.id,
                signal: input.signal,
                limits: input.limits,
                logging,
                onStatus: input.onStatus,
                onText: value => input.onText?.(
                    value,
                    DescriptionEnhancedStage.translateTags,
                ),
            });
        };
        report(textModel.id, {
            requesting: false,
            phase: LlmPhase.load,
            percent: 100,
        });
        return result;
    },
    /** Describe one image in English */
    describeImage = createDescribeImageOn(runtime),
    /** Enhance one English description */
    descriptionEnhanced = createDescriptionEnhancedOn(runtime),
    /** Translate stored tags */
    translateTags = createTranslateTagsOn(runtime);

export {
    createDescribeImageOn,
    createDescriptionEnhancedOn,
    createTranslateTagsOn,
    describeImage,
    describeModelId,
    descriptionEnhanced,
    imageReplyTokens,
    imageTranslateTokens,
    translateTags,
};
