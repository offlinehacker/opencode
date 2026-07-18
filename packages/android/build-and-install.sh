#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

: "${JAVA_HOME:?Set JAVA_HOME to a Java 17 installation}"
: "${ANDROID_HOME:?Set ANDROID_HOME to the Android SDK}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/27.0.12077973}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

if [ ! -d "$JAVA_HOME" ]; then
  echo "ERROR: JAVA_HOME does not exist: $JAVA_HOME"
  exit 1
fi

if [ "$(adb get-state 2>/dev/null || true)" != "device" ]; then
  echo "ERROR: No Android device connected. Connect via USB and enable USB debugging."
  exit 1
fi

echo "==> Building APK..."
bun run tauri android build --apk --debug

APK="$SCRIPT_DIR/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk"
if [ ! -f "$APK" ]; then
  echo "ERROR: APK not found at $APK"
  exit 1
fi

echo "==> Installing on device..."
adb install -r "$APK"

echo "==> Done! Launching app..."
adb shell am start -n ai.opencode.mobile/.MainActivity
