import { describe, expect, test } from "bun:test"
import { PushFail } from "../utils/push-pair"
import { shouldToastPairErr } from "./settings-mobile-notifications"
import { diagRows } from "./settings-mobile-notifications-data"

describe("settings mobile notifications", () => {
  test("suppresses structured pairing failure toasts", () => {
    expect(
      shouldToastPairErr(
        new PushFail({
          code: "pair_claim_timeout",
          message: "still syncing",
          action: "retry",
        }),
      ),
    ).toBe(false)
    expect(shouldToastPairErr(new Error("boom"))).toBe(true)
  })

  test("keeps relay diagnostics when push diag omits relay", () => {
    const rows = diagRows({
      push: {
        supported: true,
        permission: "authorized",
        allowed: true,
        registered: true,
        paired: true,
        generic: true,
        channel: "chan-123",
      },
      info: {
        token: true,
        tokenPending: false,
        pairID: "pair-123",
        pairStatus: "active",
        pairExpires: "2026-03-16T00:00:00.000Z",
        device: "dev-123",
        lastCode: "repair_needed",
      },
      pair: {
        id: "pair-123",
        status: "active",
        channel: "chan-123",
        device: "dev-123",
      },
      paired: true,
      run: false,
      phase: undefined,
      attempt: 2,
      spec: "@whisperopencode/push@0.2.1-phone.test",
      trace: ["2026-03-24T12:00:00.000Z success"],
      relay: "https://relay.test",
      fallback: "https://whisper.clankercontext.com",
    })

    expect(rows).toContain("relay: https://relay.test")
    expect(rows).toContain("last_code: repair_needed")
    expect(rows).toContain("flow_count: 1")
  })

  test("removes redundant host and relay actions from the shared mobile settings view", async () => {
    const file = Bun.file(new URL("./settings-mobile-notifications.tsx", import.meta.url))
    const text = await file.text()

    expect(text.includes('data-action="settings-push-relay"')).toBe(false)
    expect(text.includes('data-action="settings-push-host"')).toBe(false)
    expect(text.includes('data-action="settings-push-diagnostics"')).toBe(true)
  })
})
