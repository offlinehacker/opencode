# AGENTS.md
This is the root operating guide for agentic coding assistants in this repository.
Scope: entire repo unless a deeper `AGENTS.md` exists in a subdirectory.

## Quick Rules (Read First)
- Use Bun 1.3.x (`packageManager` is `bun@1.3.9`).
- Run commands from repo root with `bun run --cwd <package> ...` when possible.
- ALWAYS USE PARALLEL TOOLS WHEN APPLICABLE.
- Default branch is `dev`; local `main` may not exist.
- Prefer automation: execute requested actions unless blocked by missing info or safety concerns.
- Do not run tests from repo root (`bun test` intentionally fails).
- `bunfig.toml` sets test root to `./do-not-run-tests-from-root`.
- To regenerate the JS SDK, run `./packages/sdk/js/script/build.ts`.
- If API/SDK surface changes, run `./script/generate.ts`.

## Repo Map
- `packages/opencode`: core CLI, runtime, server, and TUI.
- `packages/app`: SolidJS app and unit/e2e tests.
- `packages/desktop`: Tauri desktop wrapper.
- `packages/android`, `packages/ios`: mobile wrappers.
- `packages/ui`: shared UI components/context/theme.
- `packages/sdk/js`: TypeScript SDK.
- `packages/plugin`, `packages/util`, `packages/function`: shared logic.
- `packages/console/*`: console app/core/function/resource/mail.
- `packages/web`: Astro docs/site package.
- `sdks/vscode`: VS Code extension.

## Setup And Dev
```bash
bun install
bun dev
bun dev --help
bun dev serve --port 4096
bun run --cwd packages/app dev
bun run --cwd packages/desktop tauri dev
```
- `bun dev` is the local equivalent of `opencode`.
- For CLI/TUI work: `bun dev <directory>` or `bun dev .`.

## Build, Typecheck, Lint
```bash
# repo-wide typecheck
bun run typecheck

# common builds
bun run --cwd packages/opencode build
bun run --cwd packages/app build
bun run --cwd packages/desktop build
bun run --cwd packages/android build
bun run --cwd packages/ios build
bun run --cwd packages/web build
bun run --cwd packages/enterprise build
bun run --cwd packages/plugin build
bun run --cwd packages/sdk/js build
bun run --cwd packages/console/app build

# lint/type checks
bun run --cwd packages/opencode lint
bun run --cwd sdks/vscode lint
bun run --cwd sdks/vscode check-types
```
- There is no single repo-wide `lint` script at root.
- Root formatting defaults: no semicolons, `printWidth: 120`, 2-space indent, LF endings.
- Format ad hoc with `bunx prettier --write <paths>`.

## Test Commands (Including Single-Test Runs)
- Never run tests from repo root; use package `--cwd`.

### `packages/opencode` (Bun tests)
```bash
bun run --cwd packages/opencode test
bun run --cwd packages/opencode test -- test/tool/bash.test.ts
bun run --cwd packages/opencode test -- test/tool/bash.test.ts -t "times out"
```

### `packages/app` unit tests (Bun + Happy DOM)
```bash
bun run --cwd packages/app test
bun run --cwd packages/app test:unit
bun run --cwd packages/app test:unit -- ./src/utils/server-health.test.ts
bun run --cwd packages/app test:unit -- -t "reports healthy"
# direct equivalent
bun test --preload ./happydom.ts ./src/components/prompt-input/submit.test.ts
```

### `packages/app` e2e tests (Playwright)
```bash
bun run --cwd packages/app test:e2e
bun run --cwd packages/app test:e2e -- e2e/app/home.spec.ts
bun run --cwd packages/app test:e2e -- -g "home renders and shows core entrypoints"
bun run --cwd packages/app test:e2e:ui
bun run --cwd packages/app test:e2e:report
```

### `sdks/vscode` tests
```bash
bun run --cwd sdks/vscode test
```

## Code Style Guidelines
### Imports
- Keep imports at top of file.
- Prefer explicit type imports (`import type { Foo } from "..."`) when possible.
- Use configured aliases where available (`@/*`, `@tui/*`) instead of deep relative paths.
- In `packages/app/e2e`, import `test`/`expect` from `../fixtures`, not `@playwright/test`.

### Formatting
- Follow Prettier and existing file formatting; do not hand-format inconsistently.
- No semicolons; 2 spaces; LF; UTF-8; keep lines readable (Prettier width 120).
- Minimize non-essential comments; prefer clear naming and structure.

### Types
- Avoid `any`; prefer precise types or inference.
- Add explicit annotations at exported/public boundaries.
- Use type guards in narrowing/filter paths to preserve downstream inference.
- Prefer Bun APIs when they are a natural fit (`Bun.file()`, etc.).

### Naming And Structure
- Prefer concise names; single-word identifiers are preferred when still clear.
- Use `camelCase` for vars/functions, `PascalCase` for types/components, `SCREAMING_SNAKE_CASE` for constants.
- Prefer `const` over `let`.
- Avoid unnecessary destructuring; `obj.field` is often clearer.
- Prefer early returns over `else` blocks when practical.
- Keep logic in one function unless splitting improves reuse/composition.

### Error Handling
- Avoid `try/catch` when a clearer pattern exists.
- Prefer explicit checks, early exits, and `.catch(...)` where it improves clarity.
- Return/throw errors with useful context for debugging.

### Testing Style
- Prefer testing real behavior over heavy mocks.
- Keep tests focused and avoid duplicating implementation logic in assertions.
- Use reusable fixtures/helpers.
- In `packages/opencode` tests, use `tmpdir` with `await using` for automatic cleanup.
- In e2e, prefer `data-component`/`data-action` selectors or semantic roles.

### Database Style (`packages/opencode`)
- Drizzle schema files: `src/**/*.sql.ts`.
- Naming: snake_case for tables/columns; join keys `<entity>_id`.
- Index naming: `<table>_<column>_idx`.
- Generate migrations with `bun run db generate --name <slug>`.

## Package-Specific Rules
- `packages/app`: NEVER restart the app/server process manually during debugging.
- `packages/app`: for local UI changes, run both:
  - Backend: `bun run --cwd packages/opencode --conditions=browser ./src/index.ts serve --port 4096`
  - App: `bun run --cwd packages/app dev -- --port 4444`
- `packages/app`: prefer `createStore` over many `createSignal` calls.
- `packages/desktop`: never call Tauri `invoke` directly; use `packages/desktop/src/bindings.ts`.

## Cursor/Copilot Rules
- No `.cursorrules` file found.
- No `.cursor/rules/` directory found.
- No `.github/copilot-instructions.md` found.
- If added later, treat them as authoritative and merge into this guide.
