import { ChatModelId } from '../types/enums';
import type { DescribeImageInput, DescriptionEnhanced, DescriptionEnhancedInput, ImageTag, Runtime, TranslateTagsInput } from '../types';
declare const 
/** Reply budget, about 100 words */
imageReplyTokens = 128, 
/** Translation reply budget, doubled */
imageTranslateTokens: number, 
/** Describer model, Q4 CPU build */
describeModelId = ChatModelId.qwen3_vl_2b_instruct, 
/** Build image description over one runtime */
createDescribeImageOn: (service: Runtime) => (input: DescribeImageInput) => Promise<string>, 
/** Build tag translation over one runtime */
createTranslateTagsOn: (service: Runtime) => (input: TranslateTagsInput) => Promise<ImageTag[]>, 
/** Build text enhancement over one runtime */
createDescriptionEnhancedOn: (service: Runtime) => (input: DescriptionEnhancedInput) => Promise<DescriptionEnhanced>, 
/** Describe one image in English */
describeImage: (input: DescribeImageInput) => Promise<string>, 
/** Enhance one English description */
descriptionEnhanced: (input: DescriptionEnhancedInput) => Promise<DescriptionEnhanced>, 
/** Translate stored tags */
translateTags: (input: TranslateTagsInput) => Promise<ImageTag[]>;
export { createDescribeImageOn, createDescriptionEnhancedOn, createTranslateTagsOn, describeImage, describeModelId, descriptionEnhanced, imageReplyTokens, imageTranslateTokens, translateTags, };
