import { ChatModelId } from './enums';
import type { DescribeImagesInput, DescribeTranslatedInput, ImageDescription, Runtime } from './types';
declare const 
/** System message of the describer */
imageSystem: string, 
/** System image rules */
imageRules: string, 
/** Request for every image */
imageNote = "Describe all elements of the image.";
/** Reply budget, about 100 words */
declare const imageReplyTokens = 128;
/** Describer model, Q4 CPU build */
declare const describeModelId = ChatModelId.qwen3_vl_2b_instruct;
/** Build descriptions over one runtime */
declare const createDescribeOn: (service: Runtime) => (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Build translations over one runtime */
declare const createTranslateOn: (service: Runtime) => (input: DescribeTranslatedInput) => Promise<string[]>;
/** Describe images in English, translate */
declare const describeImages: (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Translate image descriptions on GPU */
declare const describeTranslated: (input: DescribeTranslatedInput) => Promise<string[]>;
export { createDescribeOn, createTranslateOn, describeImages, describeModelId, describeTranslated, imageNote, imageReplyTokens, imageRules, imageSystem, };
