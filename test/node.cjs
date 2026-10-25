// Node verification for the built package, no DOM and no model download.
// Usage: yarn build && node test/node.cjs
const {
    createChat,
    ChatModelId,
    ChatStatus,
    LlmRole,
    LlmStatus,
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
    assertEqual(statuses[statuses.length - 1].error, `Model not ready`, `error`);
    assertEqual(cancel(), undefined, `cancel stays silent`);

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

    createChat({
        model: ChatModelId.qwen3_vl_2b,
        messages: [user(`hello`)],
    });
    await sleep(10);

    const esm = await import(`../dist/node/chat.node.min.mjs`);
    assertEqual(typeof esm.createChat, `function`, `esm createChat`);
    assertEqual(esm.ChatStatus.offline, ChatStatus.offline, `esm enum`);
    assertEqual(esm.LlmRole.user, LlmRole.user, `esm named export`);
    assertEqual(esm.ChatModelId.qwen3_vl_2b, ChatModelId.qwen3_vl_2b, `esm model id`);
    console.log(`NODE_TESTS_OK`, statuses[statuses.length - 1].status);
};

void main().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
