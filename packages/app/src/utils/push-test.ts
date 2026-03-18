import type { Platform } from "@/context/platform"

export async function sendPushTest(input: { platform: Pick<Platform, "fetch" | "testPush">; href?: string }) {
  if (!input.platform.testPush) return false
  return input.platform.testPush(input.href)
}
