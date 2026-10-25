import { LlmRole } from '../enums';
import { resizeImages } from './images';
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

/** Default token, prompt and thread budgets */
const defaultLlmLimits: LlmLimits = {
    maxReplyTokens: 200,
    maxThinkingTokens: 64,
    maxReasoningTokens: 150,
    maxImages: 2,
    maxContentLength: 1000,
    promptCharBudget: 10000,
    maxThreads: 2,
};

/** Clamp a budget at or above a floor, falling back on an unusable value */
const budgetLimit = (
    value: number | undefined,
    fallback: number,
    min: number,
): number =>
    typeof value == `number` && Number.isFinite(value) && value >= min
        ? Math.floor(value)
        : fallback;

/** Merge developer budgets over the defaults */
const resolveLlmLimits = (overrides: Partial<LlmLimits> = {}): LlmLimits => {
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
            defaults.maxReasoningTokens,
            1,
        ),
        maxImages: budgetLimit(
            overrides.maxImages,
            defaults.maxImages,
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
    ): string | EngineContentPart[] =>
        images.length
            ? [
                ...(text ? [{ type: `text` as const, text }] : []),
                ...images.map(url => ({ type: `image` as const, url })),
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
                    || !!(m.role == LlmRole.user && m.images?.length)),
            systemParts: string[] = [],
            history: EngineMessage[] = [];
        let
            used = 0,
            imagesLeft = limits.maxImages;
        for (let i = usable.length - 1; i >= 0; i--) {
            const
                m = usable[i],
                text = (typeof m.content == `string` ? m.content : ``)
                    .slice(0, maxContentLen),
                images = m.role == LlmRole.user
                    ? (m.images || [])
                        .filter(url => typeof url == `string` && !!url)
                        .slice(0, Math.max(0, imagesLeft))
                    : [];
            if (!text && !images.length) continue;
            if (text && used + text.length > limits.promptCharBudget) break;
            used += text.length;
            imagesLeft -= images.length;
            if (m.role == LlmRole.system) systemParts.unshift(text);
            else if (m.role == LlmRole.assistant)
                history.unshift({ role: `assistant`, content: text });
            else history.unshift({
                role: `user`,
                content: userContent(text, images),
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
    /** Log an engine chat call with all message text censored */
    logChatCall = (model: ChatModel, messages: EngineMessage[]) =>
        console.log(
            `Local chat call`,
            model.id,
            messages.map(({ role, content }) => ({
                role,
                content: `****`,
                ...(Array.isArray(content)
                    ? { images: content.filter(part => part.type == `image`).length }
                    : {}),
            })),
        ),
    /** Stream one reply, logging it and returning undefined when stopped */
    streamReply = async ({
        model,
        logging,
        onReason,
        onText,
        start,
        stopped,
    }: StreamReplyParams): Promise<string | undefined> => {
        let
            reply = ``,
            thought = ``,
            finish = ``;
        const splitter = createThinkSplitter(
            text => { thought += text; onReason(text); },
            text => { reply += text; onText(text); },
        );
        try {
            const chunks = await start();
            for await (const chunk of chunks) {
                if (stopped()) break;
                const
                    choice = (chunk as EngineChunk | undefined)?.choices?.[0],
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
            };
            splitter.flush();
        } catch (error) {
            if (logging) console.log(`Local chat failed`, error);
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
    }: EngineRunParams): Promise<string | undefined> => {
        const messages = await resizeImages(
            buildMessages(params.messages, params.limits));
        if (params.logging) logChatCall(model, messages);
        return await streamReply({
            model,
            logging: params.logging,
            onReason: params.onReason,
            onText: params.onText,
            start: () => start(messages),
            stopped,
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
};
