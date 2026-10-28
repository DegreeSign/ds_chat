import type { DescribeImagesInput, DescribeTranslatedInput, ImageDescription, Runtime } from './types';
/** Build image descriptions over one runtime */
declare const createDescribeOn: (service: Runtime) => (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Build translations of English image descriptions over one runtime */
declare const createTranslateOn: (service: Runtime) => (input: DescribeTranslatedInput) => Promise<string[]>;
/** Describe every image in English, then translate each description on a GPU */
declare const describeImages: (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Translate English image descriptions on a GPU */
declare const describeTranslated: (input: DescribeTranslatedInput) => Promise<string[]>;
export { createDescribeOn, createTranslateOn, describeImages, describeTranslated, };
