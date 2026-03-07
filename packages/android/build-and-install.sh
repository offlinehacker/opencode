#!/bin/bash
set -euo pipefail

# Android build-and-install script for WhisperCode
# Usage: ./build-and-install.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Environment setup
export JAVA_HOME="/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export NDK_HOME="$ANDROID_HOME/ndk/27.0.12077973"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

# Verify prerequisites
if [ ! -d "$JAVA_HOME" ]; then
  echo "ERROR: JDK 21 not found. Install with: brew install openjdk@21"
  exit 1
fi

if ! adb devices 2>/dev/null | grep -q "device$"; then
  echo "ERROR: No Android device connected. Connect via USB and enable USB debugging."
  exit 1
fi

echo "==> Building frontend..."
bun run build

echo "==> Building APK..."
bun run tauri android build --apk

APK="$SCRIPT_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
if [ ! -f "$APK" ]; then
  echo "ERROR: APK not found at $APK"
  exit 1
fi

echo "==> Installing on device..."
adb install -r "$APK"

echo "==> Done! Launching app..."
adb shell am start -n com.devgriffin.whispercode/.MainActivity
