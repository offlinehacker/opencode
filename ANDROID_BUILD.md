# Android Builds

[`packages/android/AGENTS.md`](packages/android/AGENTS.md) is the canonical Android build and release guide.

The supported environment uses Java 17, Android NDK `27.0.12077973`, and the Rust stable toolchain. From the repository root:

```bash
export JAVA_HOME=/path/to/jdk-17
export ANDROID_HOME=/path/to/android-sdk
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export PATH="$JAVA_HOME/bin:$HOME/.rustup/toolchains/stable-x86_64-unknown-linux-gnu/bin:$PATH"

bun run --cwd packages/android typecheck
bun run --cwd packages/android tauri android build
```

The release build produces a universal APK and AAB under `packages/android/src-tauri/gen/android/app/build/outputs/`. For a connected-device debug build and install, use `packages/android/build-and-install.sh` after exporting `JAVA_HOME` and `ANDROID_HOME`.

Keep release keystores, `keystore.properties`, and built artifacts out of Git. Android dictation comes from the installed keyboard; the app does not need a custom speech recognizer or microphone permission.
