/// <reference types="bun" />
import { describe, expect, test } from "bun:test"
import { createBridge, type BridgeRoot } from "./bridge"

type Request = {
  id: string
  method: string
  params?: unknown
}

const host = () => {
  const sent: Request[] = []
  const root: BridgeRoot = {
    webkit: {
      messageHandlers: {
        opencode: {
          postMessage: (value: Request) => sent.push(value),
        },
      },
    },
  }
  const bridge = createBridge(root)
  const api = root.__OPENCODE_BRIDGE__
  if (!api) throw new Error("Bridge handlers missing")
  return { bridge, sent, api }
}

describe("bridge", () => {
  test("cleans pending after a response", async () => {
    const { bridge, sent, api } = host()
    const task = bridge.sendAsync<number>("ping")
    const req = sent[0]
    if (!req) throw new Error("Request missing")

    expect(bridge.debug.pending()).toBe(1)
    api.onResponse(req.id, 7)
    await expect(task).resolves.toBe(7)
    expect(bridge.debug.pending()).toBe(0)
  })

  test("cleans pending after abort and keeps the timeout reason", async () => {
    const { bridge } = host()
    const abort = new AbortController()
    const task = bridge.sendAsync("ping", undefined, { signal: abort.signal })
    const err = new Error("ping timed out")

    expect(bridge.debug.pending()).toBe(1)
    abort.abort(err)
    await expect(task).rejects.toBe(err)
    expect(bridge.debug.pending()).toBe(0)
  })

  test("does not leak pending entries after repeated timeouts", async () => {
    const { bridge } = host()

    for (let i = 0; i < 3; i++) {
      const abort = new AbortController()
      const task = bridge.sendAsync("ping", undefined, { signal: abort.signal })
      abort.abort(new Error(`ping timed out ${i}`))
      await expect(task).rejects.toThrow(`ping timed out ${i}`)
      expect(bridge.debug.pending()).toBe(0)
    }
  })

  test("ignores late responses after abort", async () => {
    const { bridge, sent, api } = host()
    const abort = new AbortController()
    const task = bridge.sendAsync("ping", undefined, { signal: abort.signal })
    const req = sent[0]
    if (!req) throw new Error("Request missing")

    abort.abort(new Error("ping timed out"))
    await expect(task).rejects.toThrow("ping timed out")
    expect(bridge.debug.pending()).toBe(0)
    expect(() => api.onResponse(req.id, true)).not.toThrow()
    expect(bridge.debug.pending()).toBe(0)
  })

  test("resolves null when the bridge is unavailable", async () => {
    const bridge = createBridge({})

    await expect(bridge.sendAsync("ping")).resolves.toBeNull()
    expect(bridge.debug.pending()).toBe(0)
  })
})
