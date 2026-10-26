import { WebSearchProvider } from '../enums';
import { clampNumber, plainText } from './text';
import type {
    ChatTool,
    ChatToolValue,
    DuckDuckGoResponse,
    DuckDuckGoTopic,
    WebSearchConfig,
    WebSearchResult,
    WebSearchSettings,
    WikipediaResponse,
} from '../types';

/** Wikipedia host, the language edition is a subdomain */
const wikipediaHost = `wikipedia.org`;
/** DuckDuckGo instant answer endpoint */
const duckDuckGoEndpoint =
    `https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1`;
/** Language editions a Wikipedia host accepts */
const languagePattern = /^[a-z]{2,3}(-[a-z]{2,4})?$/i;
/** Default and bounded request budget, milliseconds */
const defaultTimeout = 8000;
/** Characters kept in a result title */
const titleLength = 200;
/** Default and bounded snippet length, characters */
const defaultSnippetLength = 400;

/** Resolve every search setting and clamp the caller values */
const searchSettings = (config: WebSearchConfig = {}): WebSearchSettings => {
    const language = config.language?.trim() ?? ``;
    return {
        provider: config.provider == WebSearchProvider.duckduckgo
            ? WebSearchProvider.duckduckgo
            : WebSearchProvider.wikipedia,
        language: languagePattern.test(language) ? language : `en`,
        limit: Math.round(clampNumber(config.limit, 1, 20, 3)),
        snippetLength: Math.round(
            clampNumber(config.snippetLength, 1, 4000, defaultSnippetLength)),
        timeout: clampNumber(config.timeout, 1000, 30000, defaultTimeout),
    };
};

/** Fetch one JSON document within a timeout */
const fetchJson = async <T>(url: string, timeout: number): Promise<T> => {
    const
        controller = new AbortController(),
        timer = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) throw new Error(`Search failed with ${response.status}`);
        return await response.json() as T;
    } catch (error) {
        if (controller.signal.aborted)
            throw new Error(`Search timed out after ${timeout} ms`);
        throw error;
    } finally {
        clearTimeout(timer);
    };
};

/** Search Wikipedia and map the matching pages */
const wikipediaResults = async (
    settings: WebSearchSettings,
    query: string,
): Promise<WebSearchResult[]> => {
    const
        host = `https://${settings.language}.${wikipediaHost}`,
        url = `${host}/w/rest.php/v1/search/page`
            + `?q=${encodeURIComponent(query)}&limit=${settings.limit}`,
        data = await fetchJson<WikipediaResponse>(url, settings.timeout),
        results: WebSearchResult[] = [];
    for (const page of data.pages ?? []) {
        const key = page.key;
        if (!key) continue;
        results.push({
            title: plainText(page.title ?? key, titleLength),
            url: `${host}/wiki/${encodeURIComponent(key)}`,
            snippet: plainText(
                `${page.description ?? ``} ${page.excerpt ?? ``}`,
                settings.snippetLength,
            ),
        });
    };
    return results;
};

/** Search DuckDuckGo and map the instant answer and topics */
const duckDuckGoResults = async (
    settings: WebSearchSettings,
    query: string,
): Promise<WebSearchResult[]> => {
    const
        url = `${duckDuckGoEndpoint}&q=${encodeURIComponent(query)}`,
        data = await fetchJson<DuckDuckGoResponse>(url, settings.timeout),
        results: WebSearchResult[] = [],
        seen = new Set<string>(),
        /** Keep one hit per URL */
        add = (target?: string, title?: string, text?: string) => {
            if (!target || !text || seen.has(target)) return;
            seen.add(target);
            results.push({
                title: plainText(title || text, titleLength),
                url: target,
                snippet: plainText(text, settings.snippetLength),
            });
        },
        /** Flatten one related topic group */
        walk = (topics: DuckDuckGoTopic[]) => {
            for (const topic of topics) {
                if (topic.Topics) walk(topic.Topics);
                else add(topic.FirstURL, topic.Text, topic.Text);
            };
        };
    add(data.AbstractURL, data.Heading || data.AbstractText, data.AbstractText);
    for (const item of data.Results ?? [])
        add(item.FirstURL, item.Text, item.Text);
    walk(data.RelatedTopics ?? []);
    return results.slice(0, settings.limit);
};

const webSearchTool = (config: WebSearchConfig = {}): ChatTool => {
    const settings = searchSettings(config);
    return {
        name: `websearch`,
        description: settings.provider == WebSearchProvider.duckduckgo
            ? `Search DuckDuckGo for an instant answer and related topics.`
            : `Search Wikipedia and return a few matching articles.`,
        parameters: {
            type: `object`,
            properties: {
                query: {
                    type: `string`,
                    description: `What to search for`,
                },
            },
            required: [`query`],
        },
        execute: async args => {
            const query = typeof args.query == `string` ? args.query.trim() : ``;
            if (!query) throw new Error(`Missing query`);
            // the result list is JSON-safe
            const results = settings.provider == WebSearchProvider.duckduckgo
                ? await duckDuckGoResults(settings, query)
                : await wikipediaResults(settings, query);
            return results as unknown as ChatToolValue;
        },
    };
};

export {
    duckDuckGoResults,
    searchSettings,
    webSearchTool,
    wikipediaResults,
};
