// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 so shared UI code can trigger the
// fork's native test-push bridge without depending directly on mobile wrapper implementations.

import type { Platform } from "@/context/platform"

export async function sendPushTest(input: { platform: Pick<Platform, "fetch" | "testPush">; href?: string }) {
  if (!input.platform.testPush) return false
  return input.platform.testPush(input.href)
}
