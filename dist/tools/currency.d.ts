import type { ChatTool, ChatToolValue, CurrencyResult, PriceSections } from '../types';
/** Clear the cache, used by tests */
declare const resetPrices: () => void;
/** Sections one request has to read for these symbols */
declare const sectionsFor: (symbols: string[]) => PriceSections;
/** Convert one amount between two symbols */
declare const convert: (args: Record<string, ChatToolValue>) => Promise<CurrencyResult>;
declare const currencyTool: ChatTool;
export { convert, currencyTool, resetPrices, sectionsFor };
