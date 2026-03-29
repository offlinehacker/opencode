# AGENTS.md

Root guide for agentic coding assistants working in this repository.
Scope: applies to the whole repo unless a deeper `AGENTS.md` exists.

## Quick Rules

- Use Bun `1.3.10` (`packageManager` is `bun@1.3.10`)
- Default branch is `dev`; local `main` may not exist
- Prefer `bun run --cwd <package> ...` from repo root
- Use parallel tool calls when tasks do not depend on each other
- Prefer automation: do the work unless blocked by missing info or safety concerns
- Do not run tests from repo root; `bunfig.toml` points tests at `./do-not-run-tests-from-root`
- `bun dev` is the local equivalent of `opencode`; for CLI or TUI work use `bun dev .` or `bun dev <dir>`
- If API or SDK surface changes, run `./script/generate.ts`
- To regenerate the JS SDK, run `./packages/sdk/js/script/build.ts`

## Respect Deeper Guides

More specific instructions exist and override this file:

- `packages/app/AGENTS.md`
- `packages/app/e2e/AGENTS.md`
- `packages/desktop/AGENTS.md`
- `packages/desktop-electron/AGENTS.md`
- `packages/opencode/AGENTS.md`
- `packages/opencode/test/AGENTS.md`

## Repo Map

- `packages/opencode`: core CLI, runtime, server, and TUI - DO NOT MODIFY THIS PACKAGE
- `packages/app`: Solid app with unit and e2e tests
- `packages/desktop`, `packages/desktop-electron`: desktop wrappers
- `packages/ios`, `packages/android`: mobile wrappers
- `packages/ui`, `packages/storybook`, `packages/web`: UI primitives, previews, and docs site
- `packages/sdk/js`, `sdks/vscode`: TypeScript SDK and VS Code extension 
- `packages/plugin`, `packages/util`, `packages/function`, `packages/push`, `packages/push-relay`: shared logic and push services
- `packages/console/*`: console app, core, function, resource, and mail

## Commands

```bash
# setup and dev
bun install
bun dev
bun dev --help
bun dev serve --port 4096
bun run --cwd packages/app dev
bun run --cwd packages/desktop tauri dev

# repo-wide typecheck
bun run typecheck

# common builds
bun run --cwd packages/opencode build
bun run --cwd packages/app build
bun run --cwd packages/desktop build
bun run --cwd packages/desktop-electron build
bun run --cwd packages/android build
bun run --cwd packages/ios build
bun run --cwd packages/web build
bun run --cwd packages/enterprise build
bun run --cwd packages/plugin build
bun run --cwd packages/sdk/js build
bun run --cwd packages/console/app build

# lint and checks
bun run --cwd packages/opencode lint
bun run --cwd sdks/vscode lint
bun run --cwd sdks/vscode check-types
bunx prettier --write <paths>

# tests: packages/opencode
bun run --cwd packages/opencode test
bun run --cwd packages/opencode test -- test/tool/bash.test.ts
bun run --cwd packages/opencode test -- test/tool/bash.test.ts -t "times out"

# tests: packages/app unit
bun run --cwd packages/app test:unit
bun run --cwd packages/app test:unit -- ./src/utils/server-health.test.ts
bun run --cwd packages/app test:unit -- -t "reports healthy"

# from packages/app when you need raw Bun control
bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts

# tests: packages/app e2e
bun run --cwd packages/app test:e2e
bun run --cwd packages/app test:e2e -- e2e/app/home.spec.ts
bun run --cwd packages/app test:e2e -- -g "home renders and shows core entrypoints"
bun run --cwd packages/app test:e2e:local
bun run --cwd packages/app test:e2e:ui
bun run --cwd packages/app test:e2e:report

# tests: run from packages/push
bun test src
bun test src/relay.test.ts
bun test src/relay.test.ts -t "relay"

# tests: run from packages/push-relay
bun test src
bun test src/server.test.ts
bun test src/server.test.ts -t "server"

# tests: sdks/vscode
bun run --cwd sdks/vscode test
```

- There is no single repo-wide lint script at root
- `packages/opencode`'s `lint` script is a repo check, not a standalone ESLint run
- Prefer the narrowest test command that proves the change; start with a file or test-name filter
- No dedicated single-file wrapper was found for `sdks/vscode`; use the package test harness as-is unless you add one

## Code Style Guidelines

- **Imports**: keep imports at the top; prefer `import type`; use aliases such as `@/*` and `@tui/*` when available; in `packages/app/e2e` import `test` and `expect` from `../fixtures`, not `@playwright/test`
- **Formatting**: follow existing formatting and Prettier output; no semicolons; `printWidth` is `120`; use 2-space indentation, LF endings, and UTF-8; keep comments minimal and only for non-obvious logic
- **Types**: avoid `any`; prefer precise types or inference; add explicit types at public or exported boundaries; use type guards when narrowing helps inference; prefer Bun APIs when they are a natural fit
- **Naming**: prefer concise names; use single-word names for locals, params, and helpers unless clarity suffers; avoid long camelCase compounds when a short clear name exists; use `camelCase` for values, `PascalCase` for types/components, `SCREAMING_SNAKE_CASE` for constants, and `snake_case` for DB schema names
- **Structure**: prefer `const` over `let`; prefer early returns over nested `else`; avoid unnecessary destructuring when `obj.field` is clearer; split code only when reuse or readability clearly improves; in `packages/app`, prefer `createStore` over many `createSignal` calls
- **Error handling**: avoid `try/catch` when a clearer flow exists; prefer explicit checks and early exits; use `.catch(...)` when it improves readability; return or throw errors with enough context to debug
- **Testing style**: prefer real behavior over heavy mocks; keep tests focused; reuse fixtures and helpers; in `packages/opencode` tests use `await using` with `tmpdir`; in e2e use `data-component`, `data-action`, or semantic roles; in app e2e prefer `withSession`, `trackSession`, and `trackDirectory` for cleanup

## Package-Specific Rules

- `packages/app`: never restart the app or server process manually during debugging
- `packages/app`: `opencode dev web` proxies `https://app.opencode.ai`, so local UI or CSS changes will not show there; for local UI work run backend `bun run --cwd packages/opencode --conditions=browser ./src/index.ts serve --port 4096` and app `bun run --cwd packages/app dev -- --port 4444`
- `packages/desktop`: do not call Tauri `invoke` directly; use `packages/desktop/src/bindings.ts`
- `packages/desktop-electron`: renderer code should use `window.api` from preload; main IPC handlers belong in `src/main/ipc.ts`
- `packages/opencode`: Drizzle schema files live in `src/**/*.sql.ts`; use `<entity>_id` for join keys and `<table>_<column>_idx` for DB index names
- `packages/ios`: if asked to push, release, or upload an iOS build, default to `bun run --cwd packages/ios beam`; it uploads a private TestFlight build, not a public App Store release

## Mobile Fork And Assistant Rules

- This repo is a mobile fork of `sst/opencode`; preserve `packages/ios`, `packages/android`, and mobile platform/resume/storage/share/voice integrations in `packages/app` when merging upstream
- No `.cursorrules`, `.cursor/rules/`, or `.github/copilot-instructions.md` files were found
- If any of those files appear later, treat them as authoritative and merge them with this guide
