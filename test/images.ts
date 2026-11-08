// Manual harness against local llama.cpp
// Usage: yarn test:images
// Needs server and build/test fixtures

import { createDescribeImageOn } from '../src/describe/describe';
import { buildMessages } from '../src/engines/engine';
import { resizeImages } from '../src/engines/images';
import { LlmBackend, LlmPhase, LlmStatus } from '../src/types/enums';
import type {
    EngineMessage,
    Runtime,
    RuntimeChatParams,
    RuntimeLoadParams,
} from '../src/types';

/** Endpoint forwarded by driver proxy */
const endpoint = `/llama/v1/chat/completions`;

/** Exact model on local server */
const serverModel = `unsloth/Qwen3-VL-2B-Instruct-GGUF:Q4_K_M`;

/** JSON report in results element */
const report = (value: unknown) => {
    const text = JSON.stringify(value);
    const out = document.getElementById(`results`);
    if (out) out.textContent = text;
    console.log(`TESTS_RESULT`, text);
};

/** Read blob as data URL */
const dataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(`${reader.result}`);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });

/** Prompt turn for OpenAI endpoint */
const wire = (message: EngineMessage) => ({
    role: message.role,
    content: typeof message.content == `string`
        ? message.content
        : message.content
            .map(part => {
                if (part.type == `text`) return { type: `text`, text: part.text };
                if (part.type == `image`)
                    return { type: `image_url`, image_url: { url: part.url } };
                return undefined;
            })
            .filter(Boolean),
});

/** Runtime forwarding prompts to llama.cpp */
const createForwardingRuntime = (): Runtime => ({
    load: async (params: RuntimeLoadParams) => {
        params.onProgress(1, LlmPhase.load);
        return true;
    },
    chat: async (params: RuntimeChatParams) => {
        const
            messages = await resizeImages(
                buildMessages(params.messages, params.limits),
                undefined,
                params.limits.imageTokens,
            ),
            response = await fetch(endpoint, {
                method: `POST`,
                headers: { 'content-type': `application/json` },
                body: JSON.stringify({
                    model: serverModel,
                    messages: messages.map(wire),
                    max_tokens: params.limits.maxReplyTokens,
                    temperature: params.temperature ?? 0.2,
                    repeat_penalty: params.repeatPenalty,
                }),
            });
        if (!response.ok) throw new Error(`llama ${response.status}`);
        const body = await response.json() as {
            choices?: Array<{ message?: { content?: string } }>,
        };
        const text = body.choices?.[0]?.message?.content?.trim() ?? ``;
        if (text) params.onText(text);
        return text;
    },
    unload: async () => { },
    clear: async () => { },
    ready: () => true,
    loading: () => false,
    status: () => LlmStatus.ready,
    backend: () => LlmBackend.cpu,
    error: () => undefined,
    model: () => undefined,
});

/** Read fixtures in build/test */
const loadFixtures = async (): Promise<Array<{ index: number, data: string }>> => {
    const images: Array<{ index: number, data: string }> = [];
    for (let index = 0; index < 64; index++) {
        let response = await fetch(`test/image_${index}.png`)
            .catch(() => undefined);
        if (!response?.ok) {
            response = await fetch(`test/image_${index}.jpg`)
                .catch(() => undefined);
        };
        if (!response?.ok) break;
        images.push({ index, data: await dataUrl(await response.blob()) });
    }
    return images;
};

const main = async () => {
    const
        fixtures = await loadFixtures(),
        describe = createDescribeImageOn(createForwardingRuntime());
    if (!fixtures.length) {
        console.log(
            `[images] no fixtures found in build/test, expected test/image_0.png`,
        );
        report({ pass: 0, fail: 0, skipped: `no fixtures`, rows: [] });
        return;
    }
    const probe = await fetch(`/llama/v1/models`).catch(() => undefined);
    if (!probe?.ok) {
        console.log(
            `[images] llama.cpp is not reachable at http://127.0.0.1:8080`,
        );
        report({ pass: 0, fail: 0, skipped: `no endpoint`, rows: [] });
        return;
    }
    console.log(`[images] describing ${fixtures.length} fixtures`);
    const rows: Array<{
        image: string,
        durationMs: number,
        description: string,
    }> = [];
    for (const fixture of fixtures) {
        const
            startedAt = Date.now(),
            description = await describe({ image: fixture.data });
        rows.push({
            image: `image_${fixture.index}`,
            durationMs: Date.now() - startedAt,
            description,
        });
    };
    report({ pass: rows.length, fail: 0, skipped: false, rows });
};

main().catch(error => {
    console.error(error);
    report({ pass: 0, fail: 1, skipped: false, error: `${error}` });
});
