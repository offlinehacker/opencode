---
description: build and upload an iOS TestFlight build
---

Deploy the iOS app through the existing Fastlane TestFlight flow.

Use the repository's standard path for private TestFlight uploads:

!`bun run --cwd packages/ios beam`

Important context:

- Run from the repo root
- This command auto-loads App Store Connect credentials from `packages/ios/.beam.env`
- This builds the app and uploads a private TestFlight build; it does not submit a public App Store release
- If the command fails, report the exact failing step and the key error lines
- If the command succeeds, report the app version, build number, and any important warnings or notices
