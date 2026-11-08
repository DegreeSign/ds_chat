declare const 
/** System message of the describer */
imageSystem: string, 
/** Request for every image */
imageNote: string, 
/** Nsfw flag tag word */
nsfwTag = "nsfw", 
/** System message of the tagger */
tagSystem: (imageTags: number) => string, 
/** System message of the tag translator */
tagTranslateSystem: (language: string) => string, 
/** System message of the translator */
translateSystem: string, 
/** Prompt preparing for translation */
translatePreMessage = "describe this image in English very accurately", 
/** Prompt asking for one translation */
translatePrompt: (language: string) => string;
export { imageNote, imageSystem, nsfwTag, tagSystem, tagTranslateSystem, translateSystem, translatePreMessage, translatePrompt, };
