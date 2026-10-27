import type { DescribeImagesInput, ImageDescription, Runtime } from './types';
/** Build image descriptions over one runtime */
declare const createDescribeOn: (service: Runtime) => (input: DescribeImagesInput) => Promise<ImageDescription[]>;
/** Describe every image in English, then translate each description on a GPU */
declare const describeImages: (input: DescribeImagesInput) => Promise<ImageDescription[]>;
export { createDescribeOn, describeImages };
