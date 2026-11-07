import { ChatModelId } from './enums';
import type { DescribeImageInput, DescriptionEnhanced, DescriptionEnhancedInput, ImageTag, Runtime, TranslateTagsInput } from './types';
/** Reply budget, about 100 words */
declare const imageReplyTokens = 128;
/** Translation reply budget, doubled */
declare const imageTranslateTokens: number;
/** Describer model, Q4 CPU build */
declare const describeModelId = ChatModelId.qwen3_vl_2b_instruct;
/** Build image description over one runtime */
declare const createDescribeImageOn: (service: Runtime) => (input: DescribeImageInput) => Promise<string>;
/** Build tag translation over one runtime */
declare const createTranslateTagsOn: (service: Runtime) => (input: TranslateTagsInput) => Promise<ImageTag[]>;
/** Build text enhancement over one runtime */
declare const createDescriptionEnhancedOn: (service: Runtime) => (input: DescriptionEnhancedInput) => Promise<DescriptionEnhanced>;
/** Describe one image in English */
declare const describeImage: (input: DescribeImageInput) => Promise<string>;
/** Enhance one English description */
declare const descriptionEnhanced: (input: DescriptionEnhancedInput) => Promise<DescriptionEnhanced>;
/** Translate stored tags */
declare const translateTags: (input: TranslateTagsInput) => Promise<ImageTag[]>;
export { createDescribeImageOn, createDescriptionEnhancedOn, createTranslateTagsOn, describeImage, describeModelId, descriptionEnhanced, imageReplyTokens, imageTranslateTokens, translateTags, };
