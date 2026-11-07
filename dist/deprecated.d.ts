import type { DescribeImagesInput, DescribeTranslatedInput, ImageDescription, Runtime } from './types';
/** Build deprecated image batch over one runtime */
declare const createDescribeImagesOn: (service: Runtime) => (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Build deprecated translation batch over one runtime */
declare const createDescribeTranslatedOn: (service: Runtime) => (input: DescribeTranslatedInput) => Promise<string[]>;
/** @deprecated to be removed after Nov 2027 */
declare const describeImages: (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** @deprecated to be removed after Nov 2027 */
declare const describeTranslated: (input: DescribeTranslatedInput) => Promise<string[]>;
export { createDescribeImagesOn, createDescribeTranslatedOn, describeImages, describeTranslated, };
