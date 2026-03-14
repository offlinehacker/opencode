import { describe, expect, test } from "bun:test"
import { guessPushRelayURL, normalizePushRelayURL } from "./push-relay-url"

describe("push relay url", () => {
  test("normalizes relay urls", () => {
    expect(normalizePushRelayURL("example.local:8787/"))?.toBe("http://example.local:8787")
    expect(normalizePushRelayURL(" https://push.example.com/foo?x=1 "))?.toBe("https://push.example.com")
  })

  test("guesses same-host relay urls on port 8787", () => {
    expect(guessPushRelayURL("http://192.168.1.22:4096"))?.toBe("http://192.168.1.22:8787")
    expect(guessPushRelayURL("https://demo.example.com/app"))?.toBe("https://demo.example.com:8787")
  })

  test("returns undefined for invalid urls", () => {
    expect(normalizePushRelayURL("http://[]")).toBeUndefined()
  })
})
