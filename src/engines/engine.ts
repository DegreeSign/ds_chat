import { LlmRole } from '../types/enums';
import { mobileDevice } from '../core/models';
import {
    gpuImageSize,
    imageTokens as defaultImageTokens,
    resizeImages,
} from './images';
import type {
    ChatMessage,
    ChatModel,
    EngineChunk,
    EngineContentPart,
    EngineMessage,
    EnginePromptProgress,
    EngineRunParams,
    LlmLimits,
    StreamReplyParams,
} from '../types';
import { rNum } from '@degreesign/utils';

const
    /** Default engine budgets */
    defaultLlmLimits: LlmLimits = {
        maxReplyTokens: 250,
        maxThinkingTokens: 128,
        maxReasoningTokens: 320,
        maxImages: 2,
        imageTokens: defaultImageTokens,
        maxAudio: 1,
        maxContentLength: 1000,
        promptCharBudget: 10000,
        maxThreads: 32,
        gpuShare: 0.5,
    },
    /** GPU reasoning and answer budget */
    gpuReasoningTokens = 1200,
    /** Characters per prompt token */
    promptCharsPerToken = 4,
    /** Rough prompt token count */
    promptTokenEstimate = (
        messages: EngineMessage[],
        imageTokens: number,
    ): number => {
        let count = 0;
        for (const message of messages) {
            if (typeof message.content == `string`) {
                count += message.content.length / promptCharsPerToken;
                continue;
            };
            for (const part of message.content)
                count += part.type == `text`
                    ? part.text.length / promptCharsPerToken
                    : imageTokens;
        };
        return Math.round(count);
    },
    /** Clamp a budget, with fallback */
    budgetLimit = (
        value: number | undefined,
        fallback: number,
        min: number,
    ): number =>
        typeof value == `number` && Number.isFinite(value) && value >= min
            ? Math.floor(value)
            : fallback,
    /** Merge budgets over backend defaults */
    resolveLlmLimits = (
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
            imageTokens: budgetLimit(
                overrides.imageTokens,
                defaults.imageTokens,
                1,
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
            gpuShare: typeof overrides.gpuShare == `number`
                && Number.isFinite(overrides.gpuShare)
                && overrides.gpuShare > 0
                ? Math.min(1, Math.max(0.05, overrides.gpuShare))
                : defaults.gpuShare,
        };
    },
    /** Sampling options for every stream */
    replyOptions = (
        limits: LlmLimits,
        reasoning: boolean,
        temperature = 0.7,
    ) => ({
        stream: true as const,
        temperature,
        max_tokens: reasoning
            ? limits.maxReasoningTokens
            : limits.maxReplyTokens,
    }),
    /** Model host */
    hfBase = `https://huggingface.co`,
    /** Resolve one model file URL */
    modelUrl = (repo: string, file: string): string =>
        `${hfBase}/${repo}/resolve/main/${file}`,
    /** Declared download size or zero */
    contentLength = (response: Response): number =>
        Number(response.headers.get(`content-length`)) || 0,
    /** Any turn carries this part */
    hasPart = (
        messages: EngineMessage[],
        type: EngineContentPart[`type`],
    ): boolean =>
        messages.some(message =>
            Array.isArray(message.content)
            && message.content.some(part => part.type == type)),
    /** Any turn carries an image */
    hasImages = (messages: EngineMessage[]): boolean =>
        hasPart(messages, `image`),
    /** Whether any turn carries audio */
    hasAudio = (messages: EngineMessage[]): boolean =>
        hasPart(messages, `audio`),
    /** Inline reasoning markers in content */
    thinkOpenTags = [
        `<|channel>thought\n`,
        `<|channel>thought`,
    ],
    thinkCloseTags = [`<channel|>`],
    /** Content parts of user turn */
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
    /** Flatten message content to parts */
    contentParts = (
        content: string | EngineContentPart[],
    ): EngineContentPart[] =>
        typeof content == `string`
            ? content ? [{ type: `text`, text: content }] : []
            : content,
    /** Merge same-role turns, text adjacent */
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
    /** Map host messages to turns */
    buildMessages = (
        messages: ChatMessage[],
        limits: LlmLimits = defaultLlmLimits,
    ): EngineMessage[] => {
        let
            used = 0,
            imagesLeft = limits.maxImages,
            audioLeft = limits.maxAudio;
        const
            maxContentLen = limits.maxContentLength,
            /** Redacted (empty) messages are skipped */
            usable = messages
                .filter(m => (typeof m.content == `string` && !!m.content.trim())
                    || !!(m.role == LlmRole.user
                        && (m.images?.length || m.audio?.length))),
            systemParts: string[] = [],
            history: EngineMessage[] = [];
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
        // drop leading assistant turns
        while (history.length && history[0].role != `user`) history.shift();
        // merge same-role turns for alternation
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
        const
            systemText = systemParts.join(`\n\n`),
            result: EngineMessage[] = [];
        if (systemText) result.push({ role: `system`, content: systemText });
        result.push(...merged);
        return result;
    },
    /** Split reasoning markers from content */
    createThinkSplitter = (
        onReason: (text: string) => void,
        onText: (text: string) => void,
    ) => {
        let
            carry = ``,
            inReason = false;
        const
            /** Earliest tag occurrence in data */
            findTag = (data: string, tags: string[]) => {
                let at = -1, tag = ``;
                for (const item of tags) {
                    const found = data.indexOf(item);
                    if (found >= 0 && (at < 0 || found < at)) {
                        at = found;
                        tag = item;
                    };
                };
                return { at, tag };
            },
            /** Longest suffix starting any tag */
            holdPartial = (data: string, tags: string[]): string => {
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
    },
    /** Longest wait for first chunk */
    firstReplyTimeout = mobileDevice() ? 3_000_000 : 300_000,
    /** Longest vision prefill wait */
    firstVisionReplyTimeout = Math.max(firstReplyTimeout, 840_000),
    /** Longest silence between streamed chunks */
    idleReplyTimeout = 30000,
    /** Live prompt speed tick */
    promptSpeedTick = 500;

/** Stream that stopped producing chunks */
class StallError extends Error { }

const
    /** Resolve or fail on timeout */
    withTimeout = async <T>(
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
    },
    /** Drain then close stream */
    closeStream = (iterator: AsyncIterator<unknown>) => {
        try {
            // drain the abort rejection
            void Promise.resolve(iterator.next?.())
                .catch(() => { })
                .finally(() => {
                    try { void Promise.resolve(iterator.return?.()).catch(() => { }); }
                    catch { };
                });
        } catch { };
    },
    /** Log chat call, text censored */
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
    /** Stream reply, undefined when stopped */
    streamReply = async ({
        model,
        logging,
        onReason,
        onText,
        onSpeed,
        onPromptSpeed,
        promptTokens,
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
            promptExact = false,
            promptProgress = false,
            promptLive = 0,
            promptAt = 0,
            promptDone = 0,
            promptReportedAt = 0,
            prefillAt = 0,
            promptTimer: ReturnType<typeof setInterval> | undefined,
            tokens = 0,
            startedAt = 0;
        const
            /** Publish one prompt speed */
            reportPrompt = (speed: number) => {
                if (!Number.isFinite(speed) || speed <= 0) return;
                promptLive = rNum(speed);
                onPromptSpeed?.(promptLive);
            },
            /** Estimate prompt speed so far */
            estimatePrompt = () => {
                if (seen || promptProgress || !promptTokens) return;
                const elapsed = performance.now() - prefillAt;
                if (elapsed > 0) reportPrompt(promptTokens * 1000 / elapsed);
            },
            /** Stop live prompt reporting */
            stopPrompt = () => {
                if (promptTimer == undefined) return;
                clearInterval(promptTimer);
                promptTimer = undefined;
            },
            /** Publish engine prefill progress */
            reportProgress = (progress: EnginePromptProgress | undefined) => {
                if (!progress) return;
                const
                    now = performance.now(),
                    processed = progress.n_prompt_tokens_processed
                        ?? progress.processed;
                if (typeof processed != `number` || processed <= 0) return;
                // real progress replaces estimate
                promptProgress = true;
                stopPrompt();
                let speed = 0;
                if (typeof progress.time_ms == `number` && progress.time_ms > 0)
                    speed = processed * 1000 / progress.time_ms;
                else if (promptAt)
                    speed = (processed - promptDone) * 1000
                        / Math.max(1, now - promptAt);
                else speed = processed * 1000
                    / Math.max(1, now - prefillAt);
                if (now - promptReportedAt < promptSpeedTick) return;
                promptReportedAt = now;
                promptAt = now;
                promptDone = processed;
                reportPrompt(speed);
            };
        if (onPromptSpeed && promptTokens)
            promptTimer = setInterval(estimatePrompt, promptSpeedTick);
        const splitter = createThinkSplitter(
            text => { thought += text; onReason(text); },
            text => { reply += text; onText(text); },
        );
        try {
            prefillAt = performance.now();
            const opened = start();
            // timed out start stays handled
            void Promise.resolve(opened).catch(() => { });
            const
                chunks = await withTimeout(
                    opened,
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
                    const next = iterator.next();
                    // timed out next stays handled
                    void Promise.resolve(next).catch(() => { });
                    step = await withTimeout(
                        next,
                        seen ? idleTimeoutMs : firstTimeoutMs,
                        seen ? `Model stopped responding` : `Model did not reply`,
                    );
                } catch (error) {
                    // keep text already delivered
                    if (error instanceof StallError && (reply || thought)) {
                        onStall?.();
                        closeStream(iterator);
                        if (logging) console.log(`Local chat stalled`, error);
                        break;
                    };
                    throw error;
                };
                if (step.done) break;
                const
                    chunk = step.value as EngineChunk | undefined,
                    choice = chunk?.choices?.[0],
                    delta = choice?.delta,
                    reasoned = typeof delta?.reasoning_content == `string`
                        ? delta.reasoning_content
                        : typeof delta?.reasoning == `string`
                            ? delta.reasoning
                            : ``,
                    output = !!reasoned || !!delta?.content
                        || !!choice?.finish_reason,
                    timing = chunk?.timings?.prompt_per_second;
                // prefill progress stays live
                if (!output) {
                    reportProgress(chunk?.prompt_progress);
                    if (!promptExact
                        && typeof timing == `number`
                        && Number.isFinite(timing)
                        && timing > 0) {
                        promptExact = true;
                        reportPrompt(timing);
                        stopPrompt();
                    };
                    continue;
                };
                // first token ends prefill
                if (!seen) {
                    reportProgress(chunk?.prompt_progress);
                    if (!promptLive) estimatePrompt();
                    seen = true;
                    stopPrompt();
                };
                if (!promptExact
                    && typeof timing == `number`
                    && Number.isFinite(timing)
                    && timing > 0) {
                    promptExact = true;
                    reportPrompt(timing);
                };
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
            // stalled engine must reach host
            if (error instanceof StallError && !stopped()) throw error;
        } finally {
            stopPrompt();
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
    },
    /** Build prompt, stream through engine */
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
            params.limits.imageTokens,
        );
        if (params.logging) logChatCall(model, messages);
        return await streamReply({
            model,
            logging: params.logging,
            onReason: params.onReason,
            onText: params.onText,
            onSpeed: params.onSpeed,
            onPromptSpeed: params.onPromptSpeed,
            promptTokens: promptTokenEstimate(
                messages,
                params.limits.imageTokens,
            ),
            start: () => start(messages),
            stopped,
            onStall,
            // vision prefill needs minutes
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
