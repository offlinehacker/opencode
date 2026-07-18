# WhisperCode Fork

WhisperCode is a mobile-focused fork of [OpenCode](https://github.com/anomalyco/opencode). It keeps the shared OpenCode application and server model while adding native Android and iOS clients designed for phone and tablet workflows.

## Repositories And Branches

- Fork: [offlinehacker/opencode](https://github.com/offlinehacker/opencode)
- Fork default branch: `whispercode`
- Upstream: [anomalyco/opencode](https://github.com/anomalyco/opencode)
- Upstream default branch: `dev`

The `whispercode` branch periodically rebases onto `upstream/dev`. Upstream structure and behavior should be adopted where possible, while the mobile packages and marked mobile integrations must be preserved.

## Architecture

`packages/app` is the shared SolidJS application used by web, desktop, Android, and iOS. Mobile behavior that applies to both platforms lives in this shared application.

`packages/android` is a Tauri 2 Android wrapper. It provides the Android WebView, native bridge, system integration, release configuration, and APK/AAB build.

`packages/ios` is WhisperCode's fork-specific native iOS wrapper. It is not an official upstream OpenCode iOS target. It hosts the shared application and provides native Swift integrations for storage, push notifications, voice input, haptics, sharing, and navigation.

`packages/push` and `packages/push-relay` provide fork-specific mobile notification and relay behavior.

## User-Facing Differences

- Mobile session navigation exposes `Session`, `Changes`, and `Terminal` tabs
- Context usage and file-browser controls open a shared bottom panel
- The bottom panel uses 52% height by default and pushes the chat/composer upward
- Expanding the bottom panel gives it full height and collapses the chat frame
- The terminal uses the v2 panel, mobile extra keys, touch-safe tab dragging, and software-keyboard viewport handling
- Android combines `interactive-widget=resizes-content` with `adjustResize`
- Native resume hooks refresh session state after the app returns to the foreground
- Mobile storage preserves server configuration and session routing
- Native share, voice input, haptics, and notification routing implement the shared `Platform` contract
- Large mobile review diffs are limited to protect constrained WebViews
- Push notifications include kind metadata and channel/session routing
- Hosted push pairing and relay preferences are fork-specific

## Upstream Divergences

Fork-specific shared code is marked with `UPSTREAM-DIVERGENCE` or `UPSTREAM-DIVERGENCE-FILE` comments. These comments explain behavior that must survive upstream rebases and should not be removed as ordinary cleanup.

The highest-conflict shared areas are session layout, the mobile side panel, terminal layout, platform contracts, notification routing, push utilities, and translations.

Native bridge command names are compatibility boundaries. A shared TypeScript `Platform` property can be renamed to follow upstream while the underlying Android or iOS bridge message retains its existing name.

## Versioning

Upstream-derived packages use the OpenCode release version. Android and iOS package versions and the iOS Xcode marketing version are synchronized to that release.

The iOS `CURRENT_PROJECT_VERSION` remains an independent monotonically increasing build number. Push and push-relay packages may retain independent versions.

Manual mobile prereleases use tags in the form `v<version>-mobile.<number>` and target the `whispercode` branch. Android prereleases attach the universal APK and publish its version code and SHA256.

## Maintainer Guides

- Android: [`packages/android/AGENTS.md`](packages/android/AGENTS.md)
- iOS: [`packages/ios/AGENTS.md`](packages/ios/AGENTS.md)
