import { describe, expect, test } from "bun:test"
import { canAutoPair, canClearPair, canPollPair, canReusePair, canSyncPair, relaySwitched } from "./push-pair"

describe("canPollPair", () => {
  test("allows visible pending pairs", () => {
    expect(
      canPollPair({
        id: "pair_1",
        status: "pending",
        paired: false,
        show: true,
      }),
    ).toBe(true)
  })

  test("rejects hidden or paired states", () => {
    expect(
      canPollPair({
        id: "pair_1",
        status: "claimed",
        paired: false,
        show: false,
      }),
    ).toBe(false)

    expect(
      canPollPair({
        id: "pair_1",
        status: "claimed",
        paired: true,
        show: true,
      }),
    ).toBe(false)
  })

  test("rejects terminal or expired pairs", () => {
    expect(
      canPollPair({
        id: "pair_1",
        status: "failed",
        paired: false,
        show: true,
      }),
    ).toBe(false)

    expect(
      canPollPair({
        id: "pair_1",
        status: "pending",
        expires: new Date(Date.now() - 1_000).toISOString(),
        paired: false,
        show: true,
      }),
    ).toBe(false)
  })
})

describe("canReusePair", () => {
  test("reuses live pending tokens", () => {
    expect(
      canReusePair({
        id: "pair_1",
        status: "pending",
        token: "tok_1",
        expires: new Date(Date.now() + 60_000).toISOString(),
      }),
    ).toBe(true)
  })

  test("rejects missing, active, or expired tokens", () => {
    expect(
      canReusePair({
        id: "pair_1",
        status: "active",
        token: "tok_1",
      }),
    ).toBe(false)

    expect(
      canReusePair({
        id: "pair_1",
        status: "pending",
        token: undefined,
      }),
    ).toBe(false)

    expect(
      canReusePair({
        id: "pair_1",
        status: "pending",
        token: "tok_1",
        expires: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toBe(false)
  })
})

describe("canSyncPair", () => {
  test("adopts native pairs when the local pair is terminal", () => {
    expect(
      canSyncPair({
        id: "pair_1",
        status: "failed",
        paired: false,
      }),
    ).toBe(true)

    expect(
      canSyncPair({
        id: "pair_1",
        status: "pending",
        expires: new Date(Date.now() - 1_000).toISOString(),
        paired: false,
      }),
    ).toBe(true)
  })

  test("keeps active or pollable local pairs in control", () => {
    expect(
      canSyncPair({
        id: "pair_1",
        status: "pending",
        expires: new Date(Date.now() + 60_000).toISOString(),
        paired: false,
      }),
    ).toBe(false)

    expect(
      canSyncPair({
        id: "pair_1",
        status: "active",
        paired: false,
      }),
    ).toBe(false)

    expect(
      canSyncPair({
        status: undefined,
        paired: true,
      }),
    ).toBe(false)
  })
})

describe("canClearPair", () => {
  test("allows clearing paired and pending states", () => {
    expect(canClearPair({ paired: true })).toBe(true)

    expect(
      canClearPair({
        paired: false,
        id: "pair_1",
        status: "pending",
      }),
    ).toBe(true)
  })

  test("rejects empty unpaired state", () => {
    expect(canClearPair({ paired: false })).toBe(false)
  })
})

describe("canAutoPair", () => {
  test("allows one automatic repair pass for drifted pairs", () => {
    expect(
      canAutoPair({
        auto: true,
        show: true,
        run: false,
        clear: false,
        server: true,
        relay: true,
        retry: 0,
        now: 20_000,
        push: { allowed: true, registered: true, paired: false },
      }),
    ).toBe(true)
  })

  test("blocks auto pair when repair is disabled", () => {
    expect(
      canAutoPair({
        auto: false,
        show: true,
        run: false,
        clear: false,
        server: true,
        relay: true,
        retry: 0,
        now: 30_000,
        push: { allowed: true, registered: true, paired: false },
      }),
    ).toBe(false)
  })
})

describe("relaySwitched", () => {
  test("ignores the initial relay sync and unchanged values", () => {
    expect(relaySwitched({ prev: undefined, next: "http://127.0.0.1:8787" })).toBe(false)
    expect(relaySwitched({ prev: "http://127.0.0.1:8787", next: "http://127.0.0.1:8787" })).toBe(false)
  })

  test("resets the pair when the relay target changes", () => {
    expect(relaySwitched({ prev: "http://127.0.0.1:8787", next: "http://192.168.1.22:8787" })).toBe(true)
    expect(relaySwitched({ prev: "http://127.0.0.1:8787", next: undefined })).toBe(true)
  })
})
