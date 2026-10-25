# ds_chat

Standalone TypeScript package for headless on-device AI chat, published as
`@degreesign/chat`. The package owns the model lifecycle and one streaming
generation; the host app passes messages and UI callbacks. This folder is self
contained and does not follow any host repository rules.

# Skill
Load `coding` skill of `@degreesign/skills` (probably already installed)
Load `npm` skill of `@degreesign/skills` on start (probably already installed)

## Rules

- Use `yarn` for package management.
- `@mlc-ai/web-llm` and `@wllama/wllama` are build-time dependencies. Webpack
  bundles them into `dist` as dynamic chunks; the consumer resolves no engine.
- The package imports no DOM at module load. `createChat` runs in Node and
  React; inference reports `LlmStatus.unsupported` without a browser.
- Put every interface and type in `src/types.ts`, and every enum in
  `src/enums.ts`.
- Pass an object parameter when a function takes more than one input.
- Keep lines short, at most 100 columns.
- Chain a run of adjacent `const` or `let` declarations into one statement: the
  keyword on its own line, each definition indented below it, separated by
  commas, with the last one terminated by a semicolon.
- Keep no pass-through middle function. A helper with one caller that only
  forwards a call, reshapes a few fields or renames a parameter belongs inline
  in that caller. Collapse a two-hop chain (`a -> wrapper -> b` becomes
  `a -> b`). Keep a helper only when it is shared by two or more callers,
  exported, a real processing stage, or a required API method.
- Audit the code for duplicated logic and consolidate it.
- Keep plain comments to three or four words and start them with `//`. Use a
  `/** */` block only to document a specific defined variable or function.
- Indent every file with four spaces per level and end it with a single newline.
- Never use an em dash in a file of this repository.
- Never import the host app. Every input arrives through `ChatInput`; the
  package performs no app side effects.
- The host owns messages, markup, styles and copy. The package exposes callbacks
  only and renders no UI.
- wllama assets ship under `dist/assets/wllama` and resolve beside the bundle.
  Never hardcode a host asset path; use `ChatInput.wllama` for overrides.
- Record `ChangeLog.md` only when the package gains a new export. Fixes,
  performance work and internal changes stay out of it.
- Keep `docs/architecture.html` current with every change. Update the file line
  counts, node line numbers, added or removed helpers, edges and the send flow
  in the same change, so the map never drifts from the source.
- Model weights are never stored in the repository. The engines own their
  caches.
- Never leave `dist/` in the worktree and never add it to a change. The owner
  generates and adds the build output after validating the source. If a test
  needs the bundles, build, run the check, then delete `dist/`.
- Verify with `yarn typecheck`, capped at 60 seconds per run.
- Never run release, publish or deploy commands.
- Node >= 24. The source is TypeScript built with webpack and `tsc`, imports
  have no file extension, and every bundle builds from `src/index.ts`.

## Verification

Run the package checks, then the headless browser suite.

Package checks, each capped at 60 seconds:

1. `yarn typecheck`.
2. `npx tsc -p tsconfig.test.json` to typecheck the suite.
3. When a bundle check is needed: `yarn build`, then
   `node -e "require('./dist/node/chat.node.min.js')"`, then
   `node test/node.cjs`, then `rm -rf dist`.

Headless browser suite, for any runtime change:

1. Keep the harness in `test/harness.ts`, importing the modules from
   `../src/...` and asserting every exported function of the entry.
2. Bundle it: `npx webpack --config test/webpack.config.cjs`.
3. Run it: `node test/drive.cjs "$PWD/build"`.
4. The driver exits 0 only on `"fail": 0`.
5. Delete `build/` after the run. Never commit build output.

Harness rules:

- Put the JSON report in the existing `#results` element and log
  `TESTS_RESULT`. Never append a second element with that id.
- Defer every top level test into a function. A `const` builder placed below a
  test sits in the temporal dead zone at module load.
- A failing test records its error and the suite keeps running.
- Use the fake engines in `test/fixtures.js`. Never download model
  weights and never let a test reach the network.

Coverage rules:

- Cover both entries and every public export.
- Exercise the pure helpers for exact values, and the runtime for load, chat,
  unload and cancel state transitions.
- Cover last-call-wins, cancel precedence and accumulated callback text.
- Cover `createChat` through `createChatOn` with fake engines. Never start a real
  engine in tests.

Chromium notes:

- Snap Chromium cannot write a profile in `~` or `~/.cache`. Use
  `~/snap/chromium/common/ds_chat_chrome`.
- Chromium blocks many ports below 10000 with `ERR_UNSAFE_PORT`. Use a high
  port such as `17544`.
- Launch with `--headless=new --no-sandbox --disable-gpu`.
- Read targets from `http://127.0.0.1:<port>/json/list` and speak CDP over the
  page `webSocketDebuggerUrl` with the Node global `WebSocket`.
