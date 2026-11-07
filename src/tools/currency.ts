import { oneHr, oneMin, oneSec, pNum, rNum } from '@degreesign/utils';
import type {
    ChatTool,
    ChatToolValue,
    CryptoSnapshot,
    CurrencyResult,
    FiatSnapshot,
    PriceFeed,
    PriceSections,
    PriceSnapshot,
} from '../types';

/** In-memory price cache, filled lazily */
let
    snapshot: PriceSnapshot = {},
    failedAt = 0,
    stale = false,
    hydrated = false,
    inFlight: Promise<void> | undefined;

const
    /** Public feed, every section */
    /** Price host */
    feedHost = `https://srv.coinexams.com`,
    /** Price file on the host */
    feedFile = `data.json`,
    feedUrl = `${feedHost}/${feedFile}`,
    /** localStorage key of cached snapshot */
    storageKey = `degreesign-chat-prices-v1`,
    /** Base quote, units per EUR */
    baseSymbol = `EUR`,
    /** Crypto prices valid five minutes */
    cryptoTtl = 5 * oneMin,
    /** Failed fetch backoff before retry */
    failureBackoff = 30 * oneSec,
    /** Threshold for pNum six decimals */
    exactLimit = 1e5,
    /** rNum decimals below exact limit */
    resultDigits = 8,
    /** Decimals on a percentage change */
    percentDigits = 4,
    /** Clear cache for tests */
    resetPrices = () => {
        snapshot = {};
        failedAt = 0;
        stale = false;
        hydrated = false;
        inFlight = undefined;
    },
    /** Read snapshot, ignore broken store */
    hydrate = () => {
        if (hydrated) return;
        hydrated = true;
        try {
            if (typeof localStorage == `undefined`) return;
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const saved = JSON.parse(raw) as PriceSnapshot;
            snapshot = {
                ...(saved.fiat ? { fiat: saved.fiat } : {}),
                ...(saved.crypto ? { crypto: saved.crypto } : {}),
            };
        } catch { };
    },
    /** Write snapshot, ignore refused store */
    save = () => {
        try {
            if (typeof localStorage == `undefined`) return;
            localStorage.setItem(storageKey, JSON.stringify(snapshot));
        } catch { };
    },
    /** Copy finite rates, keep zeros */
    rateTable = (values?: Record<string, number>): Record<string, number> => {
        const table: Record<string, number> = {};
        for (const [symbol, value] of Object.entries(values ?? {}))
            if (typeof value == `number` && Number.isFinite(value))
                table[symbol.trim().toUpperCase()] = value;
        return table;
    },
    /** Build fiat and metal section */
    fiatSection = (
        feed: PriceFeed,
        fetchedAt: number,
    ): FiatSnapshot | undefined => {
        const
            rates = rateTable(feed.rates?.current),
            yesterday = rateTable(feed.rates?.yesterday);
        if (!Object.keys(rates).length) return undefined;
        return {
            fetchedAt,
            sourceAt: Number(feed.rates?.date) || fetchedAt,
            rates,
            yesterday,
        };
    },
    /** Build crypto section from feed */
    cryptoSection = (
        feed: PriceFeed,
        fetchedAt: number,
    ): CryptoSnapshot | undefined => {
        const
            coins = feed.coins ?? {},
            prices: Record<string, number> = {},
            yesterday: Record<string, number> = {};
        for (const [symbol, coin] of Object.entries(coins)) {
            const
                key = symbol.trim().toUpperCase(),
                now = coin?.pr,
                prev = coin?.yst;
            if (typeof now == `number` && Number.isFinite(now))
                prices[key] = now;
            if (typeof prev == `number` && Number.isFinite(prev))
                yesterday[key] = prev;
        };
        if (!Object.keys(prices).length) return undefined;
        return {
            fetchedAt,
            sourceAt: Number(feed.date) || fetchedAt,
            prices,
            yesterday,
        };
    },
    /** Keep newer source timestamp */
    newest = <T extends { sourceAt: number }>(
        current: T | undefined,
        next: T,
    ): T => current && current.sourceAt > next.sourceAt ? current : next,
    /** Fetch feed, update requested sections */
    refresh = async ({ fiat, crypto }: PriceSections): Promise<void> => {
        try {
            const response = await fetch(feedUrl);
            if (!response.ok) throw new Error(`Price feed failed with ${response.status}`);
            const
                feed = await response.json() as PriceFeed,
                fetchedAt = Date.now(),
                fiatNext = fiat ? fiatSection(feed, fetchedAt) : undefined,
                cryptoNext = crypto ? cryptoSection(feed, fetchedAt) : undefined;
            if (fiat && !fiatNext) throw new Error(`Price feed is unavailable`);
            if (crypto && !cryptoNext) throw new Error(`Price feed is unavailable`);
            if (fiatNext) snapshot.fiat = newest(snapshot.fiat, fiatNext);
            if (cryptoNext) snapshot.crypto = newest(snapshot.crypto, cryptoNext);
            failedAt = 0;
            stale = false;
            save();
        } catch (error) {
            failedAt = Date.now();
            stale = true;
            throw error;
        };
    },
    /** Whether crypto section has symbol */
    hasCrypto = (symbol: string): boolean =>
        !!snapshot.crypto
        && (symbol in snapshot.crypto.prices || symbol in snapshot.crypto.yesterday),
    /** Whether fiat section has symbol */
    hasFiat = (symbol: string): boolean =>
        !!snapshot.fiat
        && (symbol in snapshot.fiat.rates || symbol in snapshot.fiat.yesterday),
    /** Sections needed for these symbols */
    sectionsFor = (symbols: string[]): PriceSections => {
        const sections: PriceSections = { fiat: false, crypto: false };
        for (const symbol of symbols) {
            if (symbol == baseSymbol) continue;
            const known = hasCrypto(symbol) || hasFiat(symbol);
            if (hasCrypto(symbol) || !known) sections.crypto = true;
            if (!hasCrypto(symbol)) sections.fiat = true;
        };
        return sections;
    },
    /** Refresh expired sections on demand */
    ensurePrices = async (symbols: string[]): Promise<void> => {
        const
            sections = sectionsFor(symbols),
            now = Date.now(),
            fiat = sections.fiat
                && now - (snapshot.fiat?.fetchedAt ?? 0) >= oneHr,
            crypto = sections.crypto
                && now - (snapshot.crypto?.fetchedAt ?? 0) >= cryptoTtl;
        if (!fiat && !crypto) return;
        // host reports it is offline
        if (typeof navigator != `undefined` && navigator.onLine === false) return;
        if (failedAt && now - failedAt < failureBackoff) return;
        if (!inFlight)
            inFlight = refresh({ fiat, crypto })
                .catch(() => { })
                .finally(() => { inFlight = undefined; });
        await inFlight;
    },
    /** Current EUR price per unit */
    eurNow = (symbol: string): number | undefined => {
        if (symbol == baseSymbol) return 1;
        const
            coin = snapshot.crypto?.prices[symbol],
            rate = snapshot.fiat?.rates[symbol];
        if (coin) return coin;
        return rate ? 1 / rate : undefined;
    },
    /** EUR price 24 hours ago */
    eurPrev = (symbol: string): number | undefined => {
        if (symbol == baseSymbol) return 1;
        const
            coin = snapshot.crypto?.yesterday[symbol],
            rate = snapshot.fiat?.yesterday[symbol];
        if (coin) return coin;
        return rate ? 1 / rate : undefined;
    },
    /** Read required symbol from arguments */
    readSymbol = (value: ChatToolValue | undefined, label: string): string => {
        if (typeof value != `string` || !value.trim())
            throw new Error(`Missing ${label}`);
        return value.trim().toUpperCase();
    },
    /** Read amount, default one unit */
    readAmount = (value: ChatToolValue | undefined): number => {
        if (value === undefined || value === null) return 1;
        if (typeof value != `number` || !Number.isFinite(value))
            throw new Error(`Invalid amount`);
        return value;
    },
    /** Round price, keep large decimals */
    moneyRound = (value: number): number =>
        Math.abs(value) >= exactLimit ? pNum(value) ?? value : rNum(value, resultDigits),
    /** Source times of answering sections */
    sourceTimes = (symbols: string[]): number[] => {
        const times: number[] = [];
        for (const symbol of symbols) {
            if (symbol == baseSymbol) continue;
            if (hasCrypto(symbol)) {
                if (snapshot.crypto) times.push(snapshot.crypto.sourceAt);
                continue;
            };
            if (hasFiat(symbol) && snapshot.fiat) times.push(snapshot.fiat.sourceAt);
        };
        return times;
    },
    /** Convert amount between two symbols */
    convert = async (
        args: Record<string, ChatToolValue>,
    ): Promise<CurrencyResult> => {
        hydrate();
        const
            from = readSymbol(args.from, `from`),
            to = args.to === undefined || args.to === null
                ? baseSymbol
                : readSymbol(args.to, `to`),
            amount = readAmount(args.amount);
        await ensurePrices([from, to]);
        const
            /** Look up rate, naming missing */
            rateOf = (symbol: string): number => {
                const value = eurNow(symbol);
                if (value !== undefined) return value;
                if (!snapshot.fiat && !snapshot.crypto)
                    throw new Error(`Prices unavailable offline`);
                if (hasCrypto(symbol) || hasFiat(symbol))
                    throw new Error(`Unavailable quote for ${symbol}`);
                throw new Error(`Unknown symbol ${symbol}`);
            },
            fromRate = rateOf(from),
            toRate = rateOf(to),
            previousFrom = eurPrev(from),
            previousTo = eurPrev(to),
            rate = fromRate / toRate,
            previousRate = previousFrom && previousTo
                ? previousFrom / previousTo
                : undefined,
            change = previousRate === undefined ? undefined : rate - previousRate,
            changePercent = previousRate === undefined
                ? undefined
                : (rate / previousRate - 1) * 100,
            times = sourceTimes([from, to]),
            sourceAt = times.length ? Math.min(...times) : Date.now();
        return {
            from,
            to,
            amount,
            rate: moneyRound(rate),
            ...(previousRate === undefined
                ? {}
                : {
                    previousRate: moneyRound(previousRate),
                    change: moneyRound(change ?? 0),
                    changePercent: rNum(changePercent ?? 0, percentDigits),
                }),
            result: moneyRound(amount * rate),
            updatedAt: new Date(sourceAt).toISOString(),
            stale: stale && !!(snapshot.fiat || snapshot.crypto),
        };
    },
    currencyTool: ChatTool = {
        name: `currency`,
        description: `Get the EUR price of a fiat currency, crypto coin or metal, `
            + `or convert an amount. Returns the 24-hour change.`,
        parameters: {
            type: `object`,
            properties: {
                from: {
                    type: `string`,
                    description: `Currency, coin or metal to convert from`,
                },
                to: {
                    type: `string`,
                    description: `Currency, coin or metal to convert to, EUR by default`,
                },
                amount: {
                    type: `number`,
                    description: `Amount to convert, 1 by default`,
                },
            },
            required: [`from`],
        },
        execute: args => convert(args) as unknown as Promise<ChatToolValue>,
    };

export { convert, currencyTool, resetPrices, sectionsFor };
