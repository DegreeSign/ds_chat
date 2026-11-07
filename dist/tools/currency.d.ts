import type { ChatTool, ChatToolValue, CurrencyResult, PriceSections } from '../types';
declare const 
/** Clear cache for tests */
resetPrices: () => void, 
/** Sections needed for these symbols */
sectionsFor: (symbols: string[]) => PriceSections, 
/** Convert amount between two symbols */
convert: (args: Record<string, ChatToolValue>) => Promise<CurrencyResult>, currencyTool: ChatTool;
export { convert, currencyTool, resetPrices, sectionsFor };
