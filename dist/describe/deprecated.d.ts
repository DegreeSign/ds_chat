import type { DescribeImagesInput, DescribeTranslatedInput, ImageDescription, Runtime } from '../types';
declare const 
/** Build deprecated image batch over one runtime */
createDescribeImagesOn: (service: Runtime) => (input: DescribeImagesInput) => Promise<ImageDescription[]>, 
/** Build deprecated translation batch over one runtime */
createDescribeTranslatedOn: (service: Runtime) => (input: DescribeTranslatedInput) => Promise<string[]>, 
/** @deprecated to be removed after Nov 2027 */
describeImages: (input: DescribeImagesInput) => Promise<ImageDescription[]>, 
/** @deprecated to be removed after Nov 2027 */
describeTranslated: (input: DescribeTranslatedInput) => Promise<string[]>;
export { createDescribeImagesOn, createDescribeTranslatedOn, describeImages, describeTranslated, };
