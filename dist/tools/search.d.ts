import type { ChatTool, WebSearchConfig, WebSearchResult, WebSearchSettings } from '../types';
/** Resolve settings, clamp caller values */
declare const searchSettings: (config?: WebSearchConfig) => WebSearchSettings;
/** Search Wikipedia, map matching pages */
declare const wikipediaResults: (settings: WebSearchSettings, query: string) => Promise<WebSearchResult[]>;
/** Search DuckDuckGo, map answers */
declare const duckDuckGoResults: (settings: WebSearchSettings, query: string) => Promise<WebSearchResult[]>;
declare const webSearchTool: (config?: WebSearchConfig) => ChatTool;
export { duckDuckGoResults, searchSettings, webSearchTool, wikipediaResults, };
