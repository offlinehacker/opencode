# iOS Guide

Read the root `AGENTS.md` and `WHISPERCODE.md` first.

## Fork Preservation

- This is the fork-specific native WhisperCode iOS wrapper, not an official upstream OpenCode target
- Preserve storage, server configuration, resume, push notifications, voice input, haptics, sharing, and notification routing
- Apply shared `Platform` API renames to web, Android, and iOS together while keeping native bridge command names stable
- Keep shared mobile UI in `packages/app`
- Recheck native integrations after upstream conflicts and do not bypass hooks

## Architecture

- The native project lives in `WhisperCode/WhisperCode.xcodeproj`
- The wrapper hosts `packages/app`
- `src/bridge.ts` and `src/entry-ios.tsx` connect the shared app to native handlers

## Version Sync

- `packages/ios/package.json` controls the JavaScript wrapper/runtime version
- Both Xcode `MARKETING_VERSION` values control the user-visible iOS version
- Keep package and marketing versions synchronized with upstream-derived packages
- Update the iOS workspace entry in `bun.lock`
- Keep `CURRENT_PROJECT_VERSION` as the independent increasing TestFlight build number

## Checks

```bash
bun run --cwd packages/ios typecheck
bun run --cwd packages/ios build
```

Native archive and signing require macOS and a configured Apple signing identity. Typecheck iOS after every shared `Platform` change. Keep bridge payloads backwards-compatible unless the Swift handler changes in the same commit.

## TestFlight

```bash
bun run --cwd packages/ios beam
```

- `beam` creates and uploads a private TestFlight build, not a public App Store release
- Verify `MARKETING_VERSION` and increment `CURRENT_PROJECT_VERSION` before uploading
- Do not claim an iOS artifact was released when only the Android APK was built
