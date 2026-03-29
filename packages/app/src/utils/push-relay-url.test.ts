// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to cover the fork's default relay URL
// and normalization behavior.

import { describe, expect, test } from "bun:test"
import { DEFAULT_PUSH_RELAY_URL, normalizePushRelayURL } from "./push-relay-url"

describe("push relay url", () => {
  test("uses the hosted relay by default", () => {
    expect(DEFAULT_PUSH_RELAY_URL).toBe("https://whisper.clankercontext.com")
  })

  test("normalizes relay urls", () => {
    expect(normalizePushRelayURL("example.local:8787/"))?.toBe("http://example.local:8787")
    expect(normalizePushRelayURL(" https://push.example.com/foo?x=1 "))?.toBe("https://push.example.com")
  })

  test("returns undefined for invalid urls", () => {
    expect(normalizePushRelayURL("http://[]")).toBeUndefined()
  })
})
