import { describe, expect, test } from "bun:test"
import { diagRows } from "./settings-mobile-notifications-data"

describe("settings mobile notifications", () => {
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
        pairID: "pair-123",
        pairStatus: "active",
        pairExpires: "2026-03-16T00:00:00.000Z",
        device: "dev-123",
      },
      pair: {
        id: "pair-123",
        status: "active",
        channel: "chan-123",
        device: "dev-123",
      },
      paired: true,
      relay: "https://relay.test",
      fallback: "https://whisper.clankercontext.com",
    })

    expect(rows).toContain("relay: https://relay.test")
  })

  test("removes the relay settings action from the shared mobile settings view", async () => {
    const file = Bun.file(new URL("./settings-mobile-notifications.tsx", import.meta.url))
    const text = await file.text()

    expect(text.includes('data-action="settings-push-relay"')).toBe(false)
    expect(text.includes('data-action="settings-push-diagnostics"')).toBe(true)
  })
})
