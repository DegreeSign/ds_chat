import type { ChatTool, ChatToolValue, CurrencyResult, PriceSections } from '../types';
/** Clear cache for tests */
declare const resetPrices: () => void;
/** Sections needed for these symbols */
declare const sectionsFor: (symbols: string[]) => PriceSections;
/** Convert amount between two symbols */
declare const convert: (args: Record<string, ChatToolValue>) => Promise<CurrencyResult>;
declare const currencyTool: ChatTool;
export { convert, currencyTool, resetPrices, sectionsFor };
