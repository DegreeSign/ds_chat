// Node verification for the built package, no DOM and no model download.
// Usage: yarn build && node test/node.cjs
const {
    createChat,
    preloadModel,
    builtinTools,
    calculateTool,
    currencyTool,
    webSearchTool,
    BuiltinTool,
    ChatModelId,
    ChatStatus,
    LlmBackend,
    LlmRole,
    LlmStatus,
    WebSearchProvider,
} = require(`../dist/node/chat.node.min.js`);

const assert = (condition, message) => {
    if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, label) => {
    if (actual !== expected)
        throw new Error(`${label}: expected ${String(expected)} got ${String(actual)}`);
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const user = content => ({ role: LlmRole.user, content });

const main = async () => {
    assertEqual(typeof document, `undefined`, `no document`);
    assertEqual(typeof window, `undefined`, `no window`);

    const statuses = [];
    const replies = [];
    const thoughts = [];
    const cancel = createChat({
        model: ChatModelId.qwen3_vl_2b,
        messages: [user(`hello`)],
        onThinking: text => thoughts.push(text),
        onResponse: text => replies.push(text),
        onStatus: snapshot => statuses.push(snapshot),
    });
    assertEqual(typeof cancel, `function`, `cancel handle`);
    await sleep(20);
    assertEqual(replies.length, 0, `no reply without an engine`);
    assertEqual(thoughts.length, 0, `no thinking without an engine`);
    assertEqual(statuses.length >= 1, true, `status emitted`);
    assertEqual(statuses[statuses.length - 1].status, LlmStatus.unsupported, `unsupported`);
    assertEqual(statuses[statuses.length - 1].availability, ChatStatus.offline, `offline`);
    assertEqual(statuses[statuses.length - 1].ready, false, `not ready`);
    assertEqual(statuses[statuses.length - 1].requesting, false, `not requesting`);
    assertEqual(statuses[statuses.length - 1].error,
        `Model is not supported on this device`, `error`);
    assertEqual(cancel(), undefined, `cancel stays silent`);

    const gpuStatuses = [];
    const gpuReplies = [];
    createChat({
        model: ChatModelId.gemma4_e2b,
        messages: [user(`hello`)],
        onResponse: text => gpuReplies.push(text),
        onStatus: snapshot => gpuStatuses.push(snapshot),
    });
    await sleep(20);
    assertEqual(gpuReplies.length, 0, `no gpu reply without webgpu`);
    assertEqual(
        gpuStatuses[gpuStatuses.length - 1].status,
        LlmStatus.unsupported,
        `gpu unsupported`,
    );
    assertEqual(
        gpuStatuses[gpuStatuses.length - 1].availability,
        ChatStatus.offline,
        `gpu offline`,
    );
    assertEqual(
        gpuStatuses[gpuStatuses.length - 1].error,
        `Model is not supported on this device`,
        `gpu error`,
    );

    const unknown = [];
    createChat({
        model: `missing`,
        messages: [user(`hello`)],
        onStatus: snapshot => unknown.push(snapshot),
    });
    await sleep(10);
    assertEqual(unknown[unknown.length - 1].error, `Unknown model`, `unknown model`);

    const empty = [];
    createChat({
        model: ChatModelId.qwen3_vl_2b,
        messages: [{ role: LlmRole.system, content: `only` }],
        onStatus: snapshot => empty.push(snapshot),
    });
    await sleep(10);
    assertEqual(empty.length >= 1, true, `empty prompt status`);
    assertEqual(empty[empty.length - 1].requesting, false, `empty not requesting`);

    const preloadStatuses = [];
    const preloaded = await preloadModel({
        model: ChatModelId.qwen3_vl_2b,
        limits: { maxThreads: 1 },
        onStatus: snapshot => preloadStatuses.push(snapshot),
    });
    assertEqual(preloaded, false, `no preload without an engine`);
    assertEqual(preloadStatuses.length >= 1, true, `preload status emitted`);
    assertEqual(
        preloadStatuses[preloadStatuses.length - 1].status,
        LlmStatus.unsupported,
        `preload unsupported`,
    );
    assertEqual(
        preloadStatuses[preloadStatuses.length - 1].ready,
        false,
        `preload not ready`,
    );

    const gpuPreloadStatuses = [];
    const gpuPreloaded = await preloadModel({
        model: ChatModelId.gemma4_e2b,
        onStatus: snapshot => gpuPreloadStatuses.push(snapshot),
    });
    assertEqual(gpuPreloaded, false, `no gpu preload without webgpu`);
    assertEqual(
        gpuPreloadStatuses[gpuPreloadStatuses.length - 1].status,
        LlmStatus.unsupported,
        `gpu preload unsupported`,
    );

    createChat({
        model: ChatModelId.qwen3_vl_2b,
        messages: [user(`hello`)],
    });
    await sleep(10);

    const esm = await import(`../dist/node/chat.node.min.mjs`);
    assertEqual(typeof esm.createChat, `function`, `esm createChat`);
    assertEqual(typeof esm.preloadModel, `function`, `esm preloadModel`);
    assertEqual(esm.ChatStatus.offline, ChatStatus.offline, `esm enum`);
    assertEqual(esm.LlmRole.user, LlmRole.user, `esm named export`);
    assertEqual(esm.LlmBackend.gpu, LlmBackend.gpu, `esm gpu backend`);
    assertEqual(esm.ChatModelId.qwen3_vl_2b, ChatModelId.qwen3_vl_2b, `esm model id`);
    assertEqual(esm.ChatModelId.gemma4_e2b, ChatModelId.gemma4_e2b, `esm gemma id`);
    assertEqual(esm.ChatModelId.gemma4_e2b_web, undefined, `no web model`);

    assertEqual(typeof builtinTools, `function`, `builtin tools`);
    assertEqual(BuiltinTool.websearch, `websearch`, `cjs websearch tool`);
    assertEqual(BuiltinTool.calculate, `calculate`, `cjs calculate tool`);
    assertEqual(BuiltinTool.currency, `currency`, `cjs currency tool`);
    assertEqual(WebSearchProvider.wikipedia, `wikipedia`, `cjs provider`);
    assertEqual(WebSearchProvider.duckduckgo, `duckduckgo`, `cjs search provider`);
    const tools = builtinTools([BuiltinTool.calculate, BuiltinTool.currency]);
    assertEqual(tools.length, 2, `tool count`);
    assertEqual(tools[0].name, `calculate`, `first tool`);
    assertEqual(tools[1].name, `currency`, `second tool`);
    assertEqual(calculateTool.name, `calculate`, `calculate descriptor`);
    assertEqual(currencyTool.name, `currency`, `currency descriptor`);
    assertEqual(webSearchTool().name, `websearch`, `websearch descriptor`);
    const answer = await calculateTool.execute({ expression: `6*7` });
    assertEqual(answer.result, 42, `tool answer`);
    assertEqual(esm.BuiltinTool.calculate, BuiltinTool.calculate, `esm tool enum`);
    assertEqual(
        esm.WebSearchProvider.wikipedia,
        WebSearchProvider.wikipedia,
        `esm provider enum`,
    );
    assertEqual(esm.builtinTools([BuiltinTool.calculate]).length, 1, `esm builtins`);
    console.log(`NODE_TESTS_OK`, statuses[statuses.length - 1].status);
};

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
