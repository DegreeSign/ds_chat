import type { ChatTool, WebSearchConfig, WebSearchResult, WebSearchSettings } from '../types';
declare const 
/** Resolve settings, clamp caller values */
searchSettings: (config?: WebSearchConfig) => WebSearchSettings, 
/** Search Wikipedia, map matching pages */
wikipediaResults: (settings: WebSearchSettings, query: string) => Promise<WebSearchResult[]>, 
/** Search DuckDuckGo, map answers */
duckDuckGoResults: (settings: WebSearchSettings, query: string) => Promise<WebSearchResult[]>, webSearchTool: (config?: WebSearchConfig) => ChatTool;
export { duckDuckGoResults, searchSettings, webSearchTool, wikipediaResults, };
