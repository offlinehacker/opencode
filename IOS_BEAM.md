# iOS Beam Builds

This repo now supports private TestFlight uploads directly from your Mac without pushing source changes.

## One-time setup on your Mac

1. Install fastlane:

   ```bash
   brew install fastlane
   ```

2. Create an App Store Connect API key (Users and Access -> Keys) and save the `.p8` file locally.

3. Add env vars in your shell profile:

   ```bash
   export ASC_KEY_ID="YOUR_KEY_ID"
   export ASC_ISSUER_ID="YOUR_ISSUER_ID"
   export ASC_KEY_PATH="$HOME/.keys/AuthKey_XXXXXX.p8"
   export IOS_BUNDLE_ID="com.devgriffin.whispercode"
   ```

4. Optional (recommended for SSH/Shortcuts): create `packages/ios/.beam.env` with the same vars so non-interactive shells can still run uploads.

   ```bash
   ASC_KEY_ID="YOUR_KEY_ID"
   ASC_ISSUER_ID="YOUR_ISSUER_ID"
   ASC_KEY_PATH="$HOME/.keys/AuthKey_XXXXXX.p8"
   IOS_BUNDLE_ID="com.devgriffin.whispercode"
   ```

## Run a private TestFlight upload

From repo root:

```bash
bun run --cwd packages/ios beam
```

Optional notes shown in TestFlight:

```bash
BEAM_NOTES="Voice input tweak" bun run --cwd packages/ios beam
```

## Trigger from iPhone via SSH

Use an iOS Shortcut (Run Script over SSH) with:

```bash
cd /Users/devmacmini/Code/myopencode && bun run --cwd packages/ios beam
```

That lets you kick off builds from your phone while your Mac does the build and upload.
