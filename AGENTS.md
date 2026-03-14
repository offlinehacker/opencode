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

### Naming Enforcement (Read This)

THIS RULE IS MANDATORY FOR AGENT WRITTEN CODE.

- Use single word names by default for new locals, params, and helper functions.
- Multi-word names are allowed only when a single word would be unclear or ambiguous.
- Do not introduce new camelCase compounds when a short single-word alternative is clear.
- Before finishing edits, review touched lines and shorten newly introduced identifiers where possible.
- Good short names to prefer: `pid`, `cfg`, `err`, `opts`, `dir`, `root`, `child`, `state`, `timeout`.
- Examples to avoid unless truly required: `inputPID`, `existingClient`, `connectTimeout`, `workerPath`.

```ts
// Good
const foo = 1
function journal(dir: string) {}
```

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
- `packages/ios`: if a user asks to push, release, or upload a new iOS build, assume they usually want the existing private TestFlight Fastlane flow unless they explicitly ask for an App Store production release.
- `packages/ios`: run `bun run --cwd packages/ios beam` from repo root for that flow.
- `packages/ios`: `packages/ios/script/beam` auto-loads App Store Connect credentials from `packages/ios/.beam.env`, then runs the `beam` lane in `packages/ios/fastlane/Fastfile`.
- `packages/ios`: this flow builds the app and uploads a private TestFlight build; it does not submit to the public App Store.

## Cursor/Copilot Rules

- No `.cursorrules` file found.
- No `.cursor/rules/` directory found.
- No `.github/copilot-instructions.md` found.
- If added later, treat them as authoritative and merge into this guide.

---

## WhisperCode Fork — Mobile Deviations from Upstream (sst/opencode)

This repo is a mobile (iOS/Android) fork of [sst/opencode](https://github.com/sst/opencode). The upstream remote is `upstream` (`https://github.com/sst/opencode.git`). The fork adds mobile platform support throughout `packages/app/src/` and two new packages (`packages/ios/`, `packages/android/`). **All deviations below must be preserved when merging upstream.**

### Upstream Merge Procedure

1. `git fetch upstream` and merge `upstream/dev` into a temporary branch off `dev`.
2. Resolve conflicts using the file-by-file guide below: take upstream's version as the base, then re-apply the fork additions listed for each file.
3. Delete any `README.*.md` translation files that upstream modifies but the fork has deleted.
4. Keep `README.md` as ours (WhisperCode branding).
5. For `.gitignore`: take upstream + re-add the Android lines at the bottom.
6. For `AGENTS.md`: take upstream + keep the fork's Repo Map entries, Build commands, Test Commands section, and this Mobile Deviations section.
7. After resolving, run `bun install`, `bun run typecheck`, build app/ios/android, and run tests.

### Fork-Only Files (no upstream equivalent — auto-merge cleanly)

| File                                                        | Purpose                                            |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `packages/ios/`                                             | Entire iOS Tauri wrapper package                   |
| `packages/android/`                                         | Entire Android Tauri wrapper package               |
| `packages/app/src/hooks/use-pull-to-refresh.ts`             | Touch gesture hook for pull-to-refresh (155 lines) |
| `packages/app/src/components/pull-to-refresh-indicator.tsx` | Pull-to-refresh spinner/arrow UI component         |
| `packages/app/src/pages/session/session-mobile-tabs.tsx`    | Mobile "Session"/"Changes" tab navigation          |
| `ANDROID_BUILD.md`                                          | Android release build documentation                |
| `whispercode-logo-*.png`                                    | Fork branding assets                               |

### Files Modified from Upstream (conflict risk on merge)

#### `packages/app/src/context/platform.tsx`

Extends the `Platform` type with mobile discriminators and capabilities. Usually auto-merges cleanly since upstream rarely touches this file, but verify after merge.

- `platform` discriminator includes `"ios" | "android"` (not just `"web" | "desktop"`)
- Mobile-only types: `VoiceState`, `VoiceStatus`, `VoiceStartResult`, `VoiceStopResult`
- Mobile-only methods on `Platform`: `startVoiceInput()`, `stopVoiceInput()`, `voiceStatus`, `haptic()`, `share()`

#### `packages/app/src/pages/session.tsx` (HIGH conflict risk)

Upstream refactors this file frequently. Fork adds 6 integration points:

1. **Imports** — `usePullToRefresh` from `@/hooks/use-pull-to-refresh`, `usePlatform` from `@/context/platform`
2. **`refreshActiveSession()` helper** — Cooldown-gated force-sync of the active session on resume. Uses `RESUME_SYNC_COOLDOWN_MS = 1000` and calls `sync.session.sync(id, { force: true })`
3. **`platform` + `pullToRefresh` setup** — `usePlatform()` call and `usePullToRefresh({ scrollElement, onRefresh: platform.restart, onHaptic: platform.haptic, isNestedScrollable })` — placed near the `scroller`/`content` variable declarations
4. **`onMount` resume event listeners** — `focus`, `pageshow`, `online`, `opencode:resume` (custom mobile event), `visibilitychange` — all call `refreshActiveSession()`
5. **`pullToRefresh.setRef`** — Added as `ref` on the main flex container div wrapping `SessionMobileTabs` and the session content
6. **`pullToRefresh` props** — Passed to `<MessageTimeline>`: `pulling`, `progress`, `refreshing`, `pullDistance`

#### `packages/app/src/pages/session/message-timeline.tsx` (HIGH conflict risk)

Upstream refactors this file frequently. Fork adds 4 integration points:

1. **Import** — `PullToRefreshIndicator` from `@/components/pull-to-refresh-indicator`
2. **Props type** — `pullToRefresh: { pulling: boolean; progress: number; refreshing: boolean; pullDistance: number }` on the `MessageTimeline` component props
3. **CSS** — `"overscroll-behavior-y": "contain"` added to the `ScrollView` style object (prevents iOS bounce interfering with pull-to-refresh)
4. **Component** — `<PullToRefreshIndicator pulling={...} progress={...} refreshing={...} pullDistance={...} />` rendered inside the ScrollView, after the main content `</div>`

#### `packages/app/src/context/global-sync.tsx` (MEDIUM conflict risk)

Fork adds mobile resume-from-background data refresh:

1. **Constants/state** — `RESUME_REFRESH_COOLDOWN_MS = 1000`, `lastResumeRefresh` counter. Placed just before the `loadSessions` function.
2. **`queueDirectories(clearMeta?)`** — Iterates `children.children`, optionally clears `sessionMeta`, pushes each directory to `queue`. Also called from the SSE event listener when `server.connected` or `global.disposed` fires.
3. **`refreshOnResume()`** — Cooldown-gated: calls `queue.refresh()` then `queueDirectories(true)`
4. **`onMount` event listeners** — Same pattern as session.tsx: `focus`, `pageshow`, `online`, `opencode:resume`, `visibilitychange`. All call `refreshOnResume()`.

#### `packages/app/src/context/sync.tsx` (MEDIUM conflict risk)

Fork adds a `force` option to the session sync method:

1. **Parameter** — `async sync(sessionID: string, opts?: { force?: boolean })` (upstream has no `opts` param)
2. **Usage** — `const force = opts?.force === true` — used to bypass the `hasSession` check on `sessionReq` (forces re-fetch of session data from server). The `messagesReq` side uses upstream's logic (always loads messages).
3. **Caller** — `session.tsx`'s `refreshActiveSession()` calls `sync.session.sync(id, { force: true })`

#### `packages/app/src/components/dialog-select-server.tsx` (LOW conflict risk)

Fork adds a mobile help text block after the form submit button:

```tsx
<Show when={platform.platform === "ios" || platform.platform === "android"}>
  <p class="text-text-dimmed text-12-regular mt-2">
    Can't find your server? Make sure you're serving with: <code class="...">opencode web --hostname 0.0.0.0</code>{" "}
    <a class="..." href="https://github.com/DNGriffin/whispercode?...">
      Quick Start Guide
    </a>
  </p>
</Show>
```

Also imports and uses `usePlatform`.

#### `packages/app/src/pages/home.tsx` (LOW conflict risk)

Fork adds a mobile help text link below the main content:

```tsx
{
  ;(platform.platform === "ios" || platform.platform === "android") && (
    <p class="...">
      Need help connecting? <a href="...">Quick Start Guide</a>
    </p>
  )
}
```

Also imports and uses `usePlatform`.

#### `packages/app/src/components/prompt-input.tsx` (LOW conflict risk)

Fork adds:

1. **Import + usage** — `usePlatform` from `@/context/platform`
2. **Desktop escape blur** — `platform.platform === "desktop" && platform.os === "macos"` check
3. **Voice input button** — A `<Show when={platform === "ios" || "android" && platform.startVoiceInput}>` block rendering a microphone button that calls `platform.startVoiceInput()`. Disabled during `recording`/`processing` states.

#### `packages/app/src/components/session/session-header.tsx` (LOW conflict risk)

Fork adds platform integration for session sharing:

1. **Import + usage** — `usePlatform` from `@/context/platform`
2. **Share hook** — `platform` object passed to `useSessionShare()` which uses `platform.openLink()` for share URLs

#### `packages/app/src/utils/persist.ts` (LOW conflict risk)

Fork uses `platform.storage` for async storage on mobile:

- Imports `Platform, usePlatform` from `@/context/platform`
- Checks `platform.platform !== "web" && !!platform.storage` to decide sync vs async storage
- Calls `platform.storage?.(storageName)` for mobile-specific persistence

### Root Config Deviations

| File                       | Fork change                                                                                                                                |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `README.md`                | Fully rewritten for WhisperCode branding — always keep ours                                                                                |
| `.gitignore`               | 3 Android lines at bottom: `packages/android/src-tauri/**/build/`, `packages/android/src-tauri/gen/`, `packages/android/release.keystore`  |
| `README.*.md` translations | All deleted — keep deleted when upstream modifies them                                                                                     |
| `AGENTS.md`                | Fork additions: `packages/android`/`packages/ios` in Repo Map, their build commands, Test Commands section, this Mobile Deviations section |
