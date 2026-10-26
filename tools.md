# Tools plan

Implementation plan for native tool calling in `@degreesign/chat`. This file is
the specification for a later change. It is not the change itself.

Status: ready for implementation.

## Goal

Give Gemma 4 E2B the ability to call tools on the WebGPU/LiteRT engine, ship
three useful built-ins, and let the host add its own tools in the same loop.

Built-ins:

1. `websearch`: Wikipedia by default, DuckDuckGo opt-in.
2. `calculate`: arithmetic with a safe parser.
3. `currency`: fiat, crypto and metal prices plus conversion, with a 24-hour
   change and an offline cache.

Host tools are first-class: any tool passed in `ChatInput.tools` is appended to
the built-ins, executed by the host, and offered to the model in the same
conversation.

## Locked decisions

- Tools run only on the Gemma 4 WebGPU/LiteRT engine. Qwen and the CPU engine
  report `supportsTools: false` and never receive tools.
- The package executes tool rounds. The host supplies `execute` functions and
  receives `onToolCall` and `onToolResult` callbacks.
- The package uses `AutoToolChat` from `@litert-lm/core`. No new engine
  dependency is added.
- Built-ins are on by default and selected through `ChatInput.builtins`.
- A host tool with the same name as a built-in replaces the built-in.
- `@degreesign/utils` supplies rounding and time constants.
- `tools.md` is the only planning artifact. The source and docs are the
  deliverables.

## Non-goals

- Tool calling on wllama or Qwen.
- A tool marketplace, permissions UI, or host state actions.
- A Brave or other keyed search provider.
- Server-side proxies.
- Code execution or file access.
- Streaming tool arguments token by token. The model emits complete calls.

## Public API

### Enums

Add to `src/enums.ts`:

```ts
enum BuiltinTool {
    websearch = `websearch`,
    calculate = `calculate`,
    currency = `currency`,
}

enum WebSearchProvider {
    wikipedia = `wikipedia`,
    duckduckgo = `duckduckgo`,
}
```

Export both from `src/index.ts`. The changelog records them.

### Types

Add to `src/types.ts`:

```ts
type ChatToolValue =
    | string
    | number
    | boolean
    | null
    | ChatToolValue[]
    | { [key: string]: ChatToolValue };

interface ChatToolSchema {
    type?: `object` | `array` | `string` | `number` | `integer`
        | `boolean` | `null`,
    description?: string,
    properties?: Record<string, ChatToolSchema>,
    required?: string[],
    items?: ChatToolSchema,
    enum?: string[],
}

interface ChatTool {
    name: string,
    description?: string,
    parameters?: ChatToolSchema,
    execute: (
        args: Record<string, ChatToolValue>,
    ) => ChatToolValue | Promise<ChatToolValue>,
}

interface ChatToolCall {
    id: number,
    name: string,
    arguments: Record<string, ChatToolValue>,
}

interface ChatToolResult extends ChatToolCall {
    result?: ChatToolValue,
    error?: string,
}

interface WebSearchConfig {
    provider?: WebSearchProvider,
    language?: string,
    limit?: number,
    snippetLength?: number,
    timeout?: number,
}

interface WebSearchResult {
    title: string,
    url: string,
    snippet: string,
}
```

`ChatToolSchema` mirrors the JSON-schema subset accepted by `@litert-lm/core`.
Do not import the engine's `Schema` into the public API. Convert at the engine
boundary if TypeScript needs help.

### ChatInput

Add:

```ts
/** Built-in tools to attach, all three by default */
builtins?: BuiltinTool[] | false,
/** Search provider settings */
websearch?: WebSearchConfig,
/** Extra host tools, appended after the built-ins */
tools?: ChatTool[],
/** Called before a host or built-in tool runs */
onToolCall?: (call: ChatToolCall) => void,
/** Called when a tool returns or throws */
onToolResult?: (result: ChatToolResult) => void,
/** Max tool rounds in one reply, defaults to 4 */
maxToolRounds?: number,
```

Resolution:

```ts
const builtins = input.builtins === false
    ? []
    : input.builtins ?? [
        BuiltinTool.websearch,
        BuiltinTool.calculate,
        BuiltinTool.currency,
    ];
const toolset = [...builtinTools(builtins, input.websearch), ...(input.tools ?? [])];
```

- Built-ins appear in the order of `builtins`.
- Host tools appear after them.
- A host tool whose name matches a built-in replaces it. Do not pass both to
  `AutoToolChat`, which rejects duplicates.
- Duplicate names inside `tools` are a configuration error. Report
  `Duplicate tool name <name>` before the model loads.
- `builtins: false` and no host tools gives a tool-free call.
- `websearch` settings are ignored when `websearch` is not in `builtins`.

### Status

Add `supportsTools: boolean` to `ChatStatusSnapshot`. Add `tools: boolean` to
`LitertArtifact` and set it true on both Gemma artifacts.

Add `supportsTools(model, mobile?): boolean` to `src/models.ts`, derived from
`litertArtifact(model, mobile)?.tools`.

## Engine integration

### Session type

Change `LitertSession.conversation` to
`import('@litert-lm/core').ChatInterface` so it can hold either a
`Conversation` or an `AutoToolChat`.

Add `LitertSession.tools?: ChatTool[]`.

### Building the conversation

In `src/engines/litert.ts`:

- Keep the existing preface, session config and `prefillPrefaceOnInit` logic.
- With no tools, create the conversation as today.
- With tools, create `AutoToolChat` with `engine`, `config`, `tools`,
  `recurringToolCallLimit` and `onToolProgress`.
- `recurringToolCallLimit` is `clamp(maxToolRounds, 1, 25)`, default 4.
- Map progress events:
  - `started` to `onToolCall({ id, name, arguments })`.
  - `completed` to `onToolResult({ id, name, arguments, result })`.
  - `error` to `onToolResult({ id, name, arguments, error })`.
- `stop()` keeps calling `conversation.cancel()`. `AutoToolChat` implements it.
- A running host `execute` cannot be aborted. Its result is discarded. Document
  this.

### Reuse

Reuse a live conversation only when all of these match:

- reasoning flag
- output token budget
- host message history prefix
- the tool list, including each declaration and each `execute` reference

If the host rebuilds the tool array with the same functions and declarations,
reuse it. If a declaration or function changes, create a new conversation and
pay one history prefill.

Store the tool array on the session and compare it by identity plus a shallow
field check. Do not compare only names.

### Model guard

In `chat.ts`, after `resolveLlmModel` and before `service.load`:

- If `tools` is non-empty and `!supportsTools(model)`, end with
  `Model does not accept tools`.
- If only built-ins are present and the model does not support tools, drop the
  built-ins and continue without tools. This keeps CPU/Qwen chat working.
- The snapshot always reports `supportsTools`.

In `litert.ts`, keep a defensive `Model does not accept tools` check beside the
vision and audio checks.

### Streaming

`AutoToolChat` strips `tool_calls` from the user-visible stream and re-enters
generation after executing tools. The existing normalization already reads only
`content` and `channels.thought`, so `streamReply`, `session.sent` and the
host's accumulated `onResponse` text remain consistent.

The reply may contain text emitted before a tool call plus the final answer.
That is expected. `onToolCall` and `onToolResult` are the points for rendering
tool activity.

## Built-in tools

Place the builders in:

```text
src/tools/search.ts
src/tools/calculator.ts
src/tools/currency.ts
src/tools/index.ts
src/tools/text.ts
```

`src/tools/index.ts` exports `builtinTools(builtins, config)` and shares the
markup stripping and clamping helpers in `text.ts`.

All built-ins:

- Return JSON-safe values.
- Throw a clear `Error` for invalid input or unavailable data.
- Never use `eval` or `new Function`.
- Never fetch outside `execute`.
- Keep results small enough for the 4096-token context.

### `websearch`

#### Wikipedia, default

- Endpoint:
  `https://${language}.wikipedia.org/w/rest.php/v1/search/page?q=<query>&limit=<limit>`
- CORS is `*`; no key.
- Validate `language` with `/^[a-z]{2,3}(-[a-z]{2,4})?$/i`, fall back to
  `en`.
- Clamp `limit` to 1..20, default 3.
- Map `pages[]`:
  - `title` from `title`
  - `url` from `https://${language}.wikipedia.org/wiki/${key}`
  - `snippet` from `description` plus `excerpt`
- Strip tags, decode entities, collapse whitespace, cap at `snippetLength`
  (default 400).
- Timeout defaults to 8000 ms.
- Return `WebSearchResult[]`.

#### DuckDuckGo, opt-in

- Endpoint:
  `https://api.duckduckgo.com/?q=<query>&format=json&no_html=1&skip_disambig=1`
- CORS is `*`; no key.
- The API expects a browser User-Agent. Browser `fetch` sends one. Node and
  tests must not hit the network.
- Map, in order:
  - the abstract from `AbstractText` and `AbstractURL`, titled with `Heading`
  - `Results[]`
  - `RelatedTopics[]`, flattening nested `Topics[]`
- Each item uses `FirstURL` and `Text`. Deduplicate by URL.
- Many queries return no abstract and no topics. Return `[]` rather than an
  error.
- Clamp and sanitize as above.

#### Declaration

- Name: `websearch`.
- Description differs by provider:
  - Wikipedia: `Search Wikipedia and return a few matching articles.`
  - DuckDuckGo: `Search DuckDuckGo for an instant answer and related topics.`
- Parameters: one required string `query`.

### `calculate`

Adapt MathNO's input rules but not its evaluator.

MathNO sanitises the expression and then evaluates it with `eval`. The package
must not use `eval`: CSP blocks it in many hosts and model input is untrusted.
Reuse the character whitelist, symbol mapping and percent semantics, and write a
small recursive-descent parser.

Rules:

- Normalise `×` to `*`, `÷` to `/`, `−` to `-`.
- Strip whitespace and thousands commas.
- Allow only `0-9 + - * / % ^ ( ) .`.
- Reject empty input and expressions over 200 characters.
- Grammar, lowest to highest precedence:
  - `+` and `-`
  - `*` and `/`
  - unary `+` and `-`
  - `^`, right-associative
  - numbers, parentheses, postfix `%`
- No implicit multiplication. `2(3+4)` is an error.
- No functions. Use `^0.5` for a square root.
- `%` is postfix division by 100. `200*15%` is 30, `200+10%` is 200.1.
- Reject unbalanced parentheses, division by zero, and any non-finite result.
- Return `{ expression, result }`.
- Round with `rNum(result, 12)`; above `1e5`, use `pNum` so large values keep
  decimals.

Declaration:

- Name: `calculate`.
- Description: `Evaluate an arithmetic expression. Supports + - * / % ^ and
  parentheses; % divides by 100.`
- Parameters: one required string `expression`.

### `currency`

#### Data source

`https://srv.coinexams.com/data.json`

- CORS is `*`; no key.
- The package fetches the whole file. Section TTLs decide what is accepted.
- The response shape is validated before use.

Fields:

- `rates.current[sym]`: units of `sym` per EUR.
- `rates.yesterday[sym]`: the same, 24 hours earlier.
- `rates.date`: source timestamp for fiat and metals, milliseconds.
- `coins[sym].pr`: price in EUR per unit.
- `coins[sym].yst`: price in EUR per unit, 24 hours earlier.
- `date`: source timestamp for coins, milliseconds.

Symbol classes:

- Fiat and metals come from `rates.current` / `rates.yesterday`.
- Crypto comes from `coins`.
- `EUR` is always 1.
- Metals: `XAU`, `XAG`, `XPT`, `XPD`.
- The feed quotes metals per gram. Confirm before release.
- `XPT` is zero in the feed. Treat zero or missing as unavailable.
- Crypto symbols present in both sections use `coins` and the 5-minute TTL.
- Fiat symbols present in both sections use `rates` and the hourly TTL.
- A symbol missing from both is `Unknown symbol`.

#### Conversion

```ts
eurNow(sym) = sym == EUR ? 1
    : crypto.prices[sym] ?? 1 / fiat.rates[sym]
eurPrev(sym) = sym == EUR ? 1
    : crypto.yesterday[sym] ?? 1 / fiat.yesterday[sym]

rate = eurNow(from) / eurNow(to)
previousRate = eurPrev(from) / eurPrev(to)
change = rate - previousRate
changePercent = (rate / previousRate - 1) * 100
result = amount * rate
```

- `amount` defaults to 1 and must be finite.
- `to` defaults to `EUR`.
- Uppercase and trim symbols.
- If `from` and `to` are the same, rate is 1, change is 0.
- If either previous value is missing or zero, omit `previousRate`, `change`
  and `changePercent`.
- Round `rate`, `previousRate`, `change` and `result` with `moneyRound`:
  `Math.abs(value) >= 1e5 ? pNum(value) : rNum(value, 8)`.
- Round `changePercent` with `rNum(value, 4)`.

Response:

```json
{
    "from": "USD",
    "to": "EUR",
    "amount": 100,
    "rate": 0.893855,
    "previousRate": 0.891131,
    "change": 0.002724,
    "changePercent": 0.31,
    "result": 89.3855,
    "updatedAt": "2026-10-26T03:01:09.893Z",
    "stale": false
}
```

- `updatedAt` is the older source timestamp of the sections involved, ISO
  format.
- `stale` is true when a scheduled refresh failed and the cached value is
  being served.

#### Cache

Module state:

```ts
interface FiatSnapshot {
    fetchedAt: number,
    sourceAt: number,
    rates: Record<string, number>,
    yesterday: Record<string, number>,
}

interface CryptoSnapshot {
    fetchedAt: number,
    sourceAt: number,
    prices: Record<string, number>,
    yesterday: Record<string, number>,
}

interface PriceSnapshot {
    fiat?: FiatSnapshot,
    crypto?: CryptoSnapshot,
}
```

TTLs from `@degreesign/utils`:

- Fiat and metals: `oneHr`.
- Crypto: `5 * oneMin`.
- Failure backoff: 30 seconds.

Rules:

- One in-flight fetch shared by concurrent calls.
- A fetch updates only sections whose TTL has expired.
- A crypto-triggered fetch inside the fiat hour updates crypto only. Fiat and
  metals keep their hourly values. This satisfies the "hourly at most" rule
  even though one file carries both.
- `fetchedAt` is the local fetch time. `sourceAt` is the feed timestamp.
- A successful fetch resets the failure backoff.
- A failed fetch keeps the previous snapshot, sets the backoff and returns it
  with `stale: true`.
- `navigator.onLine === false` skips the fetch and serves the snapshot.
- No snapshot and no network throws `Prices unavailable offline`.
- Persist the snapshot in `localStorage` under
  `degreesign-chat-prices-v1`, guarded by try/catch. Node and private modes
  fall back to memory.
- Hydrate lazily on the first `execute`, never at module load.
- Do not replace a newer snapshot with an older source timestamp.

#### Declaration

- Name: `currency`.
- Description: `Get the EUR price of a fiat currency, crypto coin or metal, or
  convert an amount. Returns the 24-hour change.`
- Parameters:
  - required string `from`
  - optional string `to`
  - optional number `amount`

## Custom host tools

`ChatInput.tools` is the extension point. No registration, no global state.

Contract:

- `name` is required and unique. A host tool named `websearch`, `calculate` or
  `currency` replaces that built-in.
- `description` and `parameters` are passed to the model as-is.
- `execute` receives parsed arguments and may return a value or a promise.
- Results must be JSON-safe: strings, numbers, booleans, null, arrays and plain
  objects. Anything else is a host bug.
- A thrown error becomes a tool error the model sees, and `onToolResult`
  receives `error`.
- The package does not clamp host results. The host must keep them small for
  the 4096-token context.
- The package does not time out `execute`. The host must do that itself.
- The package cannot abort a running `execute`. The result is discarded on
  cancel.
- Tools and callbacks are captured when the conversation is created. Changing
  them creates a new conversation.

## Errors and limits

- `maxToolRounds` defaults to 4 and is clamped to 1..25.
- Exceeding the round limit ends the call with the library error.
- A duplicate tool name is a configuration error before the model loads.
- Invalid tool arguments are the model's error and are returned as a tool
  response.
- Tool errors never crash the stream; they become tool results.
- Cancellation aborts generation and discards pending tool results.
- If the model emits a tool call whose name is unknown, the library returns a
  tool error to the model.

## Files

### New

- `src/tools/index.ts`: `builtinTools`, built-in ordering and overrides.
- `src/tools/search.ts`: Wikipedia and DuckDuckGo builders.
- `src/tools/calculator.ts`: parser and tool builder.
- `src/tools/currency.ts`: feed, cache, conversion and tool builder.
- `src/tools/text.ts`: markup stripping, entity decoding, clamping.

### Changed

- `src/enums.ts`: `BuiltinTool`, `WebSearchProvider`.
- `src/types.ts`: tool, search, status and session types.
- `src/models.ts`: `tools` on artifacts, `supportsTools`.
- `src/chat.ts`: status, tool resolution, model guard, callbacks.
- `src/service.ts`: thread tool fields through `RuntimeChatParams`.
- `src/engines/litert.ts`: `AutoToolChat`, progress mapping, reuse, cancel.
- `src/index.ts`: export the new enums and types.
- `package.json`: add `@degreesign/utils`.
- `README.md`: tools API, built-ins, cache, privacy.
- `docs/architecture.html`: new files, nodes, edges, flow, line counts.
- `ChangeLog.md`: new public exports.
- `THIRD_PARTIES.md`: CoinExams price feed.

`src/engines/engine.ts` needs no logic change. `EngineChatParams` carries the
tool fields to the LiteRT closure.

## Tests

Use the existing harness and fake engines. Never load a real engine or touch
the network.

Fixtures:

- A small CoinExams response with fiat, metals and crypto, plus `yesterday`
  and `yst`.
- A Wikipedia response with HTML in `excerpt`.
- A DuckDuckGo response with an abstract, results and nested topics.
- A fake `AutoToolChat` on the fake LiteRT module.

Cases:

- Calculator:
  - precedence, parentheses, unary signs
  - right-associative power
  - percent semantics
  - thousands commas
  - unbalanced input, unknown characters, division by zero, oversize input
  - large and tiny rounding
- Search:
  - default Wikipedia URL and mapping
  - language validation and fallback
  - tag stripping and entity decoding
  - DuckDuckGo abstract, related groups, empty response, dedupe
  - limit and snippet clamping
  - timeout and non-2xx errors
- Currency:
  - price and conversion for fiat, metal and crypto
  - cross-class conversion
  - 24h fields for each class
  - missing 24h values
  - unknown symbol and unavailable quote
  - TTL at 5 minutes and 1 hour
  - one fetch for concurrent calls
  - fetch failure with a cached snapshot, `stale: true`
  - failure backoff
  - no cache plus failure
  - localStorage hydration and save
  - rounding boundaries
- Tools:
  - default list, `builtins: false`, custom order
  - host tool overrides a built-in
  - duplicate host names
  - `maxToolRounds` clamping
  - `onToolCall` and `onToolResult` payloads
  - cancel during a tool round
  - conversation reuse and reset when a declaration or `execute` changes
- Chat and status:
  - `supportsTools` for Gemma and Qwen
  - host tools rejected on Qwen before load
  - built-ins dropped on Qwen while chat still works
- Node entry: new enum exports exist.

All timers and `Date.now` are stubbed per test and restored. `fetch` is stubbed.
No test downloads prices, searches or models.

## Docs

README:

- A Tools section with `builtins`, `websearch` and `tools`.
- A custom tool example with schema and `execute`.
- Built-in descriptions and the host override rule.
- Search providers, the DuckDuckGo limitation, and the Wikipedia default.
- Calculator operators and the percent rule.
- Currency fields, EUR base, grams for metals, 24h change and cache TTLs.
- Offline behaviour and `stale`.
- Privacy: search sends the query, currency fetches a public price file, and
  `builtins: ['calculate']` gives a fully local tool set.
- The 4096-token context and the need to keep tool results small.

`docs/architecture.html`:

- Add the tool files as a band.
- Add `builtinTools`, the three builders, the cache and parser nodes.
- Add edges from `chat` to tools, tools to `fetch`, and `litert` to
  `AutoToolChat`.
- Update the send flow with tool rounds.
- Update line counts and node line numbers.

`ChangeLog.md`:

- One entry for the new exports. Match the package version header rule.

`THIRD_PARTIES.md`:

- Add the CoinExams data feed: URL, purpose, no key.
- Do not add MathNO attribution. The owner supplied the repo and waived it.

## Verification

1. `yarn typecheck`, capped at 60 seconds.
2. `npx tsc -p tsconfig.test.json`, capped at 60 seconds.
3. `npx webpack --config test/webpack.config.cjs`.
4. `node test/drive.cjs "$PWD/build"`, exit 0 and `"fail": 0`.
5. Optional bundle check: `yarn build`, then
   `node -e "require('./dist/node/chat.node.min.js')"`, then `node test/node.cjs`,
   then `rm -rf dist`.

Leave `build/` in place. Never commit `dist/`.

## Implementation order

1. Add `@degreesign/utils` and the enums and types.
2. Implement `text.ts`, `calculator.ts` and its tests.
3. Implement `search.ts` and its tests.
4. Implement `currency.ts`, the cache and its tests.
5. Implement `builtinTools` and the override rules.
6. Thread tools through `chat.ts`, `service.ts` and `litert.ts`.
7. Add the fake `AutoToolChat` harness cases.
8. Update README, architecture, changelog and third parties.
9. Run the full verification.

## Risks

- Gemma 4 E2B is small; three tools with overlapping descriptions can confuse
  selection. Keep descriptions distinct and test model calls manually.
- Tool declarations consume prompt tokens. Three declarations are roughly
  200 to 250 tokens of the 4096-token context.
- `rates.date` can lag the fetch by hours. Always return the source timestamp.
- DuckDuckGo returns empty instant answers for many queries. The description
  must set expectations.
- The CoinExams schema can change. Validate the shape and fail with a clear
  error.
- `localStorage` may be unavailable. Fall back to memory without throwing.
- A host tool can flood the context. Document the result budget.
- The metal unit is inferred from the feed values. Confirm it before release.
- Conversation reuse depends on stable tool references. Document that
  rebuilding tools resets the conversation.

## Acceptance criteria

- Gemma 4 on WebGPU can call `websearch`, `calculate` and `currency`.
- A host can pass custom tools and they run in the same reply.
- A host tool named `websearch` replaces the built-in.
- `builtins: false` disables all built-ins.
- Qwen reports `supportsTools: false`; built-ins are dropped and chat works.
- Explicit host tools on Qwen fail before the model loads.
- Offline currency returns the last price, its source timestamp and
  `stale: true`.
- Repeated calls inside the TTL do not fetch.
- Tests never touch the network.
- `docs/architecture.html` matches the source.
- `ChangeLog.md` records the new exports.
