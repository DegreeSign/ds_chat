import type { ChatTool, WebSearchConfig, WebSearchResult, WebSearchSettings } from '../types';
/** Resolve every search setting and clamp the caller values */
declare const searchSettings: (config?: WebSearchConfig) => WebSearchSettings;
/** Search Wikipedia and map the matching pages */
declare const wikipediaResults: (settings: WebSearchSettings, query: string) => Promise<WebSearchResult[]>;
/** Search DuckDuckGo and map the instant answer and topics */
declare const duckDuckGoResults: (settings: WebSearchSettings, query: string) => Promise<WebSearchResult[]>;
declare const webSearchTool: (config?: WebSearchConfig) => ChatTool;
export { duckDuckGoResults, searchSettings, webSearchTool, wikipediaResults, };
