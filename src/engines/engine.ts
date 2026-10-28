import { LlmRole } from '../enums';
import { gpuImageSize, resizeImages } from './images';
import type {
    ChatMessage,
    ChatModel,
    EngineChunk,
    EngineContentPart,
    EngineMessage,
    EngineRunParams,
    LlmLimits,
    StreamReplyParams,
} from '../types';
import { rNum } from '@degreesign/utils';

/** Default token, prompt and thread budgets of the CPU engine */
const defaultLlmLimits: LlmLimits = {
    maxReplyTokens: 250,
    maxThinkingTokens: 128,
    maxReasoningTokens: 320,
    maxImages: 2,
    maxAudio: 1,
    maxContentLength: 1000,
    promptCharBudget: 10000,
    maxThreads: 6,
};

/** Reasoning budget of the GPU engine, thought plus answer */
const gpuReasoningTokens = 1200;

/** Clamp a budget at or above a floor, falling back on an unusable value */
const budgetLimit = (
    value: number | undefined,
    fallback: number,
    min: number,
): number =>
    typeof value == `number` && Number.isFinite(value) && value >= min
        ? Math.floor(value)
        : fallback;

/** Merge developer budgets over the backend defaults */
const resolveLlmLimits = (
    overrides: Partial<LlmLimits> = {},
    gpu = false,
): LlmLimits => {
    const defaults = defaultLlmLimits;
    return {
        maxReplyTokens: budgetLimit(
            overrides.maxReplyTokens,
            defaults.maxReplyTokens,
            1,
        ),
        maxThinkingTokens: budgetLimit(
            overrides.maxThinkingTokens,
            defaults.maxThinkingTokens,
            1,
        ),
        maxReasoningTokens: budgetLimit(
            overrides.maxReasoningTokens,
            gpu ? gpuReasoningTokens : defaults.maxReasoningTokens,
            1,
        ),
        maxImages: budgetLimit(
            overrides.maxImages,
            defaults.maxImages,
            0,
        ),
        maxAudio: budgetLimit(
            overrides.maxAudio,
            defaults.maxAudio,
            0,
        ),
        maxContentLength: budgetLimit(
            overrides.maxContentLength,
            defaults.maxContentLength,
            1,
        ),
        promptCharBudget: budgetLimit(
            overrides.promptCharBudget,
            defaults.promptCharBudget,
            1,
        ),
        maxThreads: budgetLimit(
            overrides.maxThreads,
            defaults.maxThreads,
            1,
        ),
    };
};

/** Sampling options shared by every engine stream */
const replyOptions = (limits: LlmLimits, reasoning: boolean) => ({
    stream: true as const,
    temperature: 0.7,
    max_tokens: reasoning
        ? limits.maxReasoningTokens
        : limits.maxReplyTokens,
});

const
    /** Model host */
    hfBase = `https://huggingface.co`,
    /** Resolve one model file on the model host */
    modelUrl = (repo: string, file: string): string =>
        `${hfBase}/${repo}/resolve/main/${file}`,
    /** Declared size of one download, zero when the host hides it */
    contentLength = (response: Response): number =>
        Number(response.headers.get(`content-length`)) || 0,
    /** Whether any turn carries a part of one type */
    hasPart = (
        messages: EngineMessage[],
        type: EngineContentPart[`type`],
    ): boolean =>
        messages.some(message =>
            Array.isArray(message.content)
            && message.content.some(part => part.type == type)),
    /** Whether any turn carries an image */
    hasImages = (messages: EngineMessage[]): boolean =>
        hasPart(messages, `image`),
    /** Whether any turn carries audio */
    hasAudio = (messages: EngineMessage[]): boolean =>
        hasPart(messages, `audio`);

const
    /** Reasoning markers emitted inline in the streamed content */
    thinkOpenTags = [
        `<|channel>thought\n`,
        `<|channel>thought`,
        `...`,
    ],
    thinkCloseTags = [`<channel|>`, `...`],
    /** Content parts of one user turn */
    userContent = (
        text: string,
        images: string[],
        audio: string[],
    ): string | EngineContentPart[] =>
        images.length || audio.length
            ? [
                ...(text ? [{ type: `text` as const, text }] : []),
                ...images.map(url => ({ type: `image` as const, url })),
                ...audio.map(url => ({ type: `audio` as const, url })),
            ]
            : text,
    /** Flatten one message content to parts */
    contentParts = (
        content: string | EngineContentPart[],
    ): EngineContentPart[] =>
        typeof content == `string`
            ? content ? [{ type: `text`, text: content }] : []
            : content,
    /** Merge two same-role turns, keeping text adjacent */
    mergeContent = (
        first: string | EngineContentPart[],
        next: string | EngineContentPart[],
    ): string | EngineContentPart[] => {
        if (typeof first == `string` && typeof next == `string`)
            return `${first}\n${next}`;
        const parts: EngineContentPart[] = [];
        for (const part of [
            ...contentParts(first),
            { type: `text`, text: `\n` } as EngineContentPart,
            ...contentParts(next),
        ]) {
            const last = parts[parts.length - 1];
            if (part.type == `text` && last?.type == `text`) last.text += part.text;
            else parts.push(part);
        };
        return parts;
    },
    /** Map the host messages to OpenAI-style turns, bounded for local context */
    buildMessages = (
        messages: ChatMessage[],
        limits: LlmLimits = defaultLlmLimits,
    ): EngineMessage[] => {
        const
            maxContentLen = limits.maxContentLength,
            /** Redacted (empty) messages are skipped */
            usable = messages
                .filter(m => (typeof m.content == `string` && !!m.content.trim())
                    || !!(m.role == LlmRole.user
                        && (m.images?.length || m.audio?.length))),
            systemParts: string[] = [],
            history: EngineMessage[] = [];
        let
            used = 0,
            imagesLeft = limits.maxImages,
            audioLeft = limits.maxAudio;
        for (let i = usable.length - 1; i >= 0; i--) {
            const
                m = usable[i],
                text = (typeof m.content == `string` ? m.content : ``)
                    .slice(0, maxContentLen),
                images = m.role == LlmRole.user
                    ? (m.images || [])
                        .filter(url => typeof url == `string` && !!url)
                        .slice(0, Math.max(0, imagesLeft))
                    : [],
                audio = m.role == LlmRole.user
                    ? (m.audio || [])
                        .filter(url => typeof url == `string` && !!url)
                        .slice(0, Math.max(0, audioLeft))
                    : [];
            if (!text && !images.length && !audio.length) continue;
            if (text && used + text.length > limits.promptCharBudget) break;
            used += text.length;
            imagesLeft -= images.length;
            audioLeft -= audio.length;
            if (m.role == LlmRole.system) systemParts.unshift(text);
            else if (m.role == LlmRole.assistant)
                history.unshift({ role: `assistant`, content: text });
            else history.unshift({
                role: `user`,
                content: userContent(text, images, audio),
            });
        };
        // drop leading assistant turns, the transcript starts with user
        while (history.length && history[0].role != `user`) history.shift();
        // merge consecutive same-role turns, engines need strict alternation
        const merged: EngineMessage[] = [];
        for (const msg of history) {
            const last = merged[merged.length - 1];
            if (last?.role == `assistant` && msg.role == `assistant`)
                last.content = `${last.content}\n${msg.content}`;
            else if (last?.role == `user` && msg.role == `user`)
                last.content = mergeContent(last.content, msg.content);
            else if (msg.role == `assistant`)
                merged.push({ role: `assistant`, content: msg.content as string });
            else merged.push({ role: `user`, content: msg.content });
        };
        // system turn comes first
        const systemText = systemParts.join(`\n\n`);
        const result: EngineMessage[] = [];
        if (systemText) result.push({ role: `system`, content: systemText });
        result.push(...merged);
        return result;
    },
    /** Split inline reasoning markers out of the streamed content */
    createThinkSplitter = (
        onReason: (text: string) => void,
        onText: (text: string) => void,
    ) => {
        let
            carry = ``,
            inReason = false;
        /** Earliest occurrence of any tag in `data` */
        const findTag = (data: string, tags: string[]) => {
            let at = -1, tag = ``;
            for (const item of tags) {
                const found = data.indexOf(item);
                if (found >= 0 && (at < 0 || found < at)) {
                    at = found;
                    tag = item;
                };
            };
            return { at, tag };
        };
        /** Longest suffix of `data` that starts any tag, held back */
        const holdPartial = (data: string, tags: string[]): string => {
            let hold = ``;
            for (const tag of tags) {
                const max = Math.min(data.length, tag.length - 1);
                for (let len = max; len > hold.length; len--)
                    if (data.endsWith(tag.slice(0, len))) {
                        hold = data.slice(data.length - len);
                        break;
                    };
            };
            return hold;
        };
        return {
            feed: (text: string) => {
                let data = carry + text;
                carry = ``;
                while (data) {
                    if (!inReason) {
                        const { at, tag } = findTag(data, thinkOpenTags);
                        if (at >= 0) {
                            if (at) onText(data.slice(0, at));
                            data = data.slice(at + tag.length);
                            if (data.startsWith(`\n`)) data = data.slice(1);
                            inReason = true;
                            continue;
                        };
                        const hold = holdPartial(data, thinkOpenTags);
                        onText(data.slice(0, data.length - hold.length));
                        carry = hold;
                        break;
                    } else {
                        const { at, tag } = findTag(data, thinkCloseTags);
                        if (at >= 0) {
                            if (at) onReason(data.slice(0, at));
                            data = data.slice(at + tag.length);
                            inReason = false;
                            continue;
                        };
                        const hold = holdPartial(data, thinkCloseTags);
                        onReason(data.slice(0, data.length - hold.length));
                        carry = hold;
                        break;
                    };
                };
            },
            flush: () => {
                if (!carry) return;
                if (inReason) onReason(carry); else onText(carry);
                carry = ``;
            },
        };
    };

const
    /** Longest wait for the first streamed chunk, milliseconds */
    firstReplyTimeout = 360000,
    /** Longest wait for the first chunk of an image turn, milliseconds */
    firstVisionReplyTimeout = 840000,
    /** Longest silence between two streamed chunks, milliseconds */
    idleReplyTimeout = 30000;

/** A stream that stopped producing chunks */
class StallError extends Error { }

/** Resolve a promise or fail once its budget runs out */
const withTimeout = async <T>(
    work: Promise<T>,
    ms: number,
    message: string,
): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            work,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new StallError(message)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    };
};

/** Close one stream without waiting for a stalled engine */
const closeStream = (iterator: AsyncIterator<unknown>) => {
    try { void Promise.resolve(iterator.return?.()).catch(() => { }); }
    catch { };
};

const
    /** Log an engine chat call with all message text censored */
    logChatCall = (model: ChatModel, messages: EngineMessage[]) =>
        console.log(
            `Local chat call`,
            model.id,
            messages.map(({ role, content }) => ({
                role,
                content: `****`,
                ...(Array.isArray(content)
                    ? {
                        images: content.filter(part => part.type == `image`).length,
                        audio: content.filter(part => part.type == `audio`).length,
                    }
                    : {}),
            })),
        ),
    /** Stream one reply, logging it and returning undefined when stopped */
    streamReply = async ({
        model,
        logging,
        onReason,
        onText,
        onSpeed,
        start,
        stopped,
        firstTimeoutMs = firstReplyTimeout,
        idleTimeoutMs = idleReplyTimeout,
        onStall,
    }: StreamReplyParams): Promise<string | undefined> => {
        let
            reply = ``,
            thought = ``,
            finish = ``,
            seen = false,
            tokens = 0,
            startedAt = 0;
        const splitter = createThinkSplitter(
            text => { thought += text; onReason(text); },
            text => { reply += text; onText(text); },
        );
        try {
            const
                chunks = await withTimeout(
                    start(),
                    firstTimeoutMs,
                    `Model did not start`,
                ),
                iterator = chunks[Symbol.asyncIterator]();
            while (true) {
                if (stopped()) {
                    closeStream(iterator);
                    break;
                };
                let step: IteratorResult<unknown>;
                try {
                    step = await withTimeout(
                        iterator.next(),
                        seen ? idleTimeoutMs : firstTimeoutMs,
                        seen ? `Model stopped responding` : `Model did not reply`,
                    );
                } catch (error) {
                    // keep the text already delivered by a slow stream
                    if (error instanceof StallError && (reply || thought)) {
                        onStall?.();
                        closeStream(iterator);
                        if (logging) console.log(`Local chat stalled`, error);
                        break;
                    };
                    throw error;
                };
                if (step.done) break;
                seen = true;
                const
                    choice = (step.value as EngineChunk | undefined)?.choices?.[0],
                    delta = choice?.delta,
                    reasoned = typeof delta?.reasoning_content == `string`
                        ? delta.reasoning_content
                        : typeof delta?.reasoning == `string`
                            ? delta.reasoning
                            : ``;
                if (choice?.finish_reason) finish = choice.finish_reason;
                if (reasoned) {
                    thought += reasoned;
                    onReason(reasoned);
                };
                if (delta?.content) splitter.feed(delta.content);
                if (reasoned || delta?.content) {
                    const now = performance.now();
                    if (!tokens) startedAt = now;
                    tokens += 1;
                    if (tokens > 1 && now > startedAt)
                        onSpeed?.(rNum(tokens * 1000 / (now - startedAt)));
                };
            };
            splitter.flush();
        } catch (error) {
            if (logging) console.log(`Local chat failed`, error);
            // a stalled engine must reach the host
            if (error instanceof StallError && !stopped()) throw error;
        };
        const result = stopped() ? undefined : reply || undefined;
        if (logging) {
            console.log(`Local chat reply`, model.id, result ? `****` : ``);
            console.log(
                `Local chat finish`,
                model.id,
                finish || `none`,
                reply.length,
                thought.length,
            );
        };
        return result;
    };

const
    /** Build the prompt and stream one reply through an engine */
    runEngineChat = async ({
        model,
        params,
        start,
        stopped,
        onStall,
    }: EngineRunParams): Promise<string | undefined> => {
        const messages = await resizeImages(
            buildMessages(params.messages, params.limits),
            model.litert ? gpuImageSize : undefined,
        );
        if (params.logging) logChatCall(model, messages);
        return await streamReply({
            model,
            logging: params.logging,
            onReason: params.onReason,
            onText: params.onText,
            onSpeed: params.onSpeed,
            start: () => start(messages),
            stopped,
            onStall,
            // vision prefill on the CPU engine needs minutes for one image
            firstTimeoutMs: hasImages(messages)
                ? firstVisionReplyTimeout
                : firstReplyTimeout,
        });
    };

export {
    buildMessages,
    createThinkSplitter,
    logChatCall,
    runEngineChat,
    streamReply,
    replyOptions,
    defaultLlmLimits,
    resolveLlmLimits,
    hasImages,
    hasAudio,
    modelUrl,
    contentLength,
};
