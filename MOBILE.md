# OpenCode Mobile

OpenCode mobile adds an independently maintained Android client around the shared [OpenCode](https://github.com/anomalyco/opencode) application and connects to an OpenCode server. The mobile platform work is maintained separately from the upstream OpenCode project.

## Repositories And Branches

- Mobile repository: [offlinehacker/opencode](https://github.com/offlinehacker/opencode)
- Upstream: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- Upstream default branch: `dev`

Mobile work is reconstructed as a stack rather than treating one branch as the base for every platform change:

- `mobile-shared-v2` is the V2-only shared mobile application base
- `android-mobile` adds the Android/Tauri package directly on that shared base
- `ios-mobile` is a separate dependent branch and owns its platform-specific implementation and documentation

Changes to shared V2 mobile behavior belong on `mobile-shared-v2`. Changes to the Tauri shell, Android bridge, Android resources, or Android builds belong on `android-mobile`. Legacy session UI adaptations are out of scope for this stack.

## Android Architecture

`packages/app` contains the shared SolidJS application and V2 session workspace. The shared base covers touch interaction, compact V2 navigation and panels, software-keyboard layout, resume recovery, and constrained-WebView safeguards.

`packages/android` is a Tauri 2 Android shell around `packages/app`. It provides the Android WebView, persisted server onboarding and credentials, external links, local notifications, haptics, sharing, foreground resume signaling, and APK/AAB packaging.

The shell combines `interactive-widget=resizes-content` in `packages/android/index.html` with `android:windowSoftInputMode="adjustResize"` in the tracked Android manifest so the V2 composer follows the software keyboard.

Android does not provide custom app voice input, use `SpeechRecognizer`, or request microphone permission. Dictation is supplied by the installed Android keyboard when that keyboard supports it. The previous custom Android voice path was removed in favor of keyboard dictation.

## Maintenance Boundaries

Fork-specific shared code may be marked with `UPSTREAM-DIVERGENCE` or `UPSTREAM-DIVERGENCE-FILE` comments. Preserve those markers while rebasing the shared base and revalidate V2 session state, touch input, terminal behavior, review rendering, resume recovery, and platform capability changes.

Keep Android bridge command names stable unless the TypeScript caller and native plugin change together. Recheck onboarding, storage, external links, notifications, haptics, sharing, keyboard resizing, and resume handling after Android or shared `Platform` changes.

Upstream-derived package versions remain aligned. Keep `packages/android/package.json`, its `bun.lock` workspace entry, `packages/app`, and `packages/opencode` synchronized when adopting a new release.

## Build Guide

See [`ANDROID_BUILD.md`](ANDROID_BUILD.md) for the quick build path and [`packages/android/AGENTS.md`](packages/android/AGENTS.md) for Android maintenance, verification, and release details.
