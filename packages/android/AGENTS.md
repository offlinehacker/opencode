# Android Guide

Read the root `AGENTS.md` and `WHISPERCODE.md` first.

## Fork Preservation

- The fork default branch is `whispercode`; upstream uses `dev`
- Keep shared mobile behavior in `packages/app`
- Preserve `UPSTREAM-DIVERGENCE` markers and Android platform integrations during upstream rebases
- Apply shared `Platform` API renames to web, Android, and iOS together while keeping native bridge command names stable
- Recheck safe areas, resume, storage, share, voice, push, terminal, and mobile panel behavior after layout conflicts
- Do not bypass commit or push hooks

## Android Architecture

- This package is a Tauri 2 shell around `packages/app`
- `src/entry-android.tsx` implements the Android `Platform` contract
- `src-tauri/tauri.conf.json` reads the version from `packages/android/package.json`
- Preserve `interactive-widget=resizes-content` in `index.html`
- Preserve `android:windowSoftInputMode="adjustResize"` in the tracked generated Android manifest

## Version Sync

When adopting a new upstream release, update `packages/android/package.json` and its workspace version in `bun.lock`. Keep it synchronized with `packages/app` and `packages/opencode`.

## Build Prerequisites

- Java 17
- Android SDK through `ANDROID_HOME`
- NDK `27.0.12077973`
- Rustup stable before Homebrew Rust in `PATH`

```bash
export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64
export ANDROID_HOME="$HOME/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export PATH="$HOME/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:$PATH"
```

## Build

```bash
bun run --cwd packages/android typecheck
bun run --cwd packages/android tauri android build
```

- Do not run `tauri android build -- --apk`; `--apk` will be forwarded to Cargo and fail
- A normal build compiles `aarch64`, `armv7`, `i686`, and `x86_64`
- Wait for all ABI builds and the final Gradle packaging step

Outputs:

```text
packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
packages/android/src-tauri/gen/android/app/build/outputs/bundle/universalRelease/app-universal-release.aab
```

## Verify

```bash
APK=packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
sha256sum "$APK"
"$ANDROID_HOME/build-tools/35.0.0/aapt" dump badging "$APK"
```

Confirm that `versionName` matches `packages/android/package.json`, the APK timestamp is current, and all ABIs completed.

## GitHub Prerelease

- Use tags in the form `v<version>-mobile.<number>`
- Target `whispercode` on `offlinehacker/opencode`
- Mark manual mobile releases as prereleases
- Attach the universal APK and include `versionName`, `versionCode`, and SHA256 in the notes

```bash
VERSION=$(bun -p 'require("./packages/android/package.json").version')
PRERELEASE=1
TAG="v${VERSION}-mobile.${PRERELEASE}"

gh release create "$TAG" "$APK#WhisperCode Android universal APK" \
  --repo offlinehacker/opencode \
  --target whispercode \
  --prerelease \
  --title "WhisperCode Mobile v${VERSION} Prerelease ${PRERELEASE}"
```
