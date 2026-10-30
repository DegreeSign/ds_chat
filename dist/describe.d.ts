import { ChatModelId } from './enums';
import type { DescribeImagesInput, DescribeTranslatedInput, ImageDescription, Runtime } from './types';
/** Model that describes every image, the Q3 build keeps the CPU pass light */
declare const describeModelId = ChatModelId.qwen3_vl_2b_instruct_q3;
/** Build image descriptions over one runtime */
declare const createDescribeOn: (service: Runtime) => (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Build translations of English image descriptions over one runtime */
declare const createTranslateOn: (service: Runtime) => (input: DescribeTranslatedInput) => Promise<string[]>;
/** Describe every image in English, then translate each description on a GPU */
declare const describeImages: (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Translate English image descriptions on a GPU */
declare const describeTranslated: (input: DescribeTranslatedInput) => Promise<string[]>;
export { createDescribeOn, createTranslateOn, describeImages, describeModelId, describeTranslated, };
