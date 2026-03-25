import { describe, expect, test } from "bun:test"
import { claimPush, fetchWithTimeout, mergePushIssue, PushFail, pushIssue, runPushSetup } from "./push-pair"
import { pairPush, PushPlugin } from "./push-plugin"

type Run = {
  out?: string
  open?: boolean
  error?: boolean
  close?: boolean
  boom?: string
}

type Cmd = {
  command: string
  args: string[]
  cwd?: string
}

type Req = {
  url: string
  method: string
}

type Pair = {
  status?: "pending" | "claimed" | "active" | "expired" | "failed"
  message?: string
  channel_id?: string
  device_id?: string
  device_secret?: string
}

function push(
  input?: Partial<{
    permission: "unsupported" | "not-determined" | "denied" | "authorized" | "provisional" | "ephemeral"
    allowed: boolean
    registered: boolean
    paired: boolean
    diag: {
      token?: boolean
      lastCode?: string
      lastError?: string
    }
  }>,
) {
  return {
    supported: true,
    permission: input?.permission ?? "authorized",
    allowed: input?.allowed ?? true,
    registered: input?.registered ?? true,
    paired: input?.paired ?? false,
    generic: true,
    diag: input?.diag,
  }
}

function stub(input: { runs: Run[]; pairs?: Pair[]; cfg?: { plugin?: string[] } }) {
  const cmds: Cmd[] = []
  const urls: string[] = []
  const reqs: Req[] = []
  const patches: Array<{ plugin?: string[] }> = []
  const bodies: string[] = []
  const runs = new Map<string, Run>()
  const OriginalSocket = globalThis.WebSocket
  let cfg = {
    plugin: input.cfg?.plugin ?? [],
  }
  let id = 0
  let pair = 0

  class Socket extends EventTarget {
    readyState = 0
    binaryType = "blob"

    constructor(readonly url: string) {
      super()
      const match = this.url.match(/\/pty\/(pty_\d+)\/connect/)
      const plan = match ? runs.get(match[1]) : undefined
      if (plan?.boom) {
        throw new DOMException(plan.boom)
      }
      queueMicrotask(() => {
        if (plan?.open === false) {
          if (plan.error !== false) {
            this.dispatchEvent(new Event("error"))
          }
          this.close()
          return
        }
        this.readyState = 1
        this.dispatchEvent(new Event("open"))
        this.dispatchEvent(new MessageEvent("message", { data: new Uint8Array([0]).buffer }))
        if (plan?.out) {
          this.dispatchEvent(new MessageEvent("message", { data: plan.out }))
        }
        if (plan?.error) {
          this.dispatchEvent(new Event("error"))
        }
        if (plan?.close !== false) {
          this.close()
        }
      })
    }

    send(_data: string | ArrayBuffer | Uint8Array) {}

    close(_code?: number, _reason?: string) {
      if (this.readyState === 3) return
      this.readyState = 3
      queueMicrotask(() => {
        this.dispatchEvent(new Event("close"))
      })
    }
  }

  globalThis.WebSocket = Socket as unknown as typeof WebSocket

  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const req = url instanceof Request ? url : undefined
    const text = req?.url ?? String(url)
    const method = init?.method ?? req?.method ?? "GET"
    const path = new URL(text).pathname
    const body = init?.body ? String(init.body) : req ? await req.clone().text() : ""
    urls.push(text)
    reqs.push({ url: text, method })

    if (path === "/global/config" && method === "GET") {
      return Response.json(cfg)
    }

    if (path === "/global/config" && method === "PATCH") {
      bodies.push(body)
      const next = (body ? JSON.parse(body) : {}) as { plugin?: string[]; config?: { plugin?: string[] } }
      const data = next.config ?? next
      patches.push(data)
      cfg = {
        ...cfg,
        ...data,
      }
      return Response.json(cfg)
    }

    if (path === "/global/dispose" && method === "POST") {
      return Response.json(true)
    }

    if (path === "/path") {
      return Response.json({ state: "/tmp/opencode", directory: "/repo/demo" })
    }

    if (path === "/pty") {
      const next = (body ? JSON.parse(body) : {}) as { command?: string; args?: string[]; cwd?: string }
      id += 1
      const key = `pty_${id}`
      cmds.push({ command: next.command ?? "", args: next.args ?? [], cwd: next.cwd })
      runs.set(key, input.runs[id - 1] ?? input.runs.at(-1) ?? {})
      return Response.json({ id: `pty_${id}` })
    }

    if (path.includes("/pty/") && path.endsWith("/result")) {
      throw new Error("unexpected /pty/:id/result request")
    }

    if (path.includes("/v1/pair/")) {
      const item = input.pairs?.[pair] ?? input.pairs?.at(-1) ?? { status: "pending" }
      pair += 1
      return Response.json(item)
    }

    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch

  return {
    fetch,
    cmds,
    urls,
    reqs,
    patches,
    bodies,
    restore() {
      globalThis.WebSocket = OriginalSocket
    },
  }
}

async function withStub<T>(
  input: { runs: Run[]; pairs?: Pair[]; cfg?: { plugin?: string[] } },
  fn: (next: ReturnType<typeof stub>) => Promise<T>,
) {
  const next = stub(input)
  try {
    return await fn(next)
  } finally {
    next.restore()
  }
}

describe("fetchWithTimeout", () => {
  test("returns successful responses", async () => {
    const fetch = (async () => new Response("ok", { status: 200 })) as unknown as typeof globalThis.fetch

    const res = await fetchWithTimeout(fetch, "http://localhost:4096/pty", {}, "Push pairing command", 10)

    expect(res.status).toBe(200)
    expect(await res.text()).toBe("ok")
  })

  test("fails with a helpful timeout error", async () => {
    let aborted = false
    const fetch = ((_: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => {
            aborted = true
            reject(new DOMException("Aborted", "AbortError"))
          },
          { once: true },
        )
      })) as unknown as typeof globalThis.fetch

    await expect(fetchWithTimeout(fetch, "http://localhost:4096/pty", {}, "Push pairing command", 10)).rejects.toThrow(
      "Push pairing command timed out. Check that the server is reachable and try again.",
    )
    expect(aborted).toBe(true)
  })
})

describe("claimPush", () => {
  test("waits for the pair command to finish after the relay claims", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "claimed" }],
      },
      async (next) => {
        const res = await claimPush({
          platform: { fetch: next.fetch },
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          token: "ptok_1",
          relay: "http://localhost:8787",
          pairId: "pair_1",
        })

        expect(res).toEqual({ ok: true, pair: { status: "claimed" } })
        expect(next.cmds.map((item) => item.command)).toEqual(["bunx"])
        expect(next.cmds[0]?.args).toContain("pair")
        expect(next.cmds[0]?.args).toContain("--json")
        expect(next.urls.some((item) => item.endsWith("/result"))).toBe(false)
      },
    )
  })

  test("waits for relay claim after a successful pair response", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "pending" }, { status: "pending" }, { status: "pending" }, { status: "claimed" }],
      },
      async (next) => {
        const res = await claimPush({
          platform: { fetch: next.fetch },
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          token: "ptok_1",
          relay: "http://localhost:8787",
          pairId: "pair_1",
        })

        expect(res).toEqual({ ok: true, pair: { status: "claimed" } })
        expect(next.cmds.map((item) => item.command)).toEqual(["bunx"])
        expect(next.urls.filter((item) => item.includes("/v1/pair/")).length).toBeLessThanOrEqual(4)
      },
    )
  })

  test("falls back to bunx when the first PTY closes before the relay claims", async () => {
    await withStub(
      {
        runs: [{ out: "npx failed" }, { out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "pending" }, { status: "pending" }, { status: "active" }],
      },
      async (next) => {
        const res = await claimPush({
          platform: { fetch: next.fetch },
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          token: "ptok_1",
          relay: "http://localhost:8787",
          pairId: "pair_1",
        })

        expect(res).toEqual({ ok: true, pair: { status: "active" } })
        expect(next.cmds.map((item) => item.command)).toEqual(["bunx", "npx"])
      },
    )
  })

  test("surfaces relay terminal states as hard failures", async () => {
    await withStub(
      {
        runs: [{ close: false }],
        pairs: [{ status: "failed", message: "pair_failed" }],
      },
      async (next) => {
        await expect(
          claimPush({
            platform: { fetch: next.fetch },
            server: { type: "http", http: { url: "http://localhost:4096" } } as any,
            token: "ptok_1",
            relay: "http://localhost:8787",
            pairId: "pair_1",
          }),
        ).rejects.toThrow("pair_failed")
      },
    )
  })

  test("includes command output when both runners end before any relay claim", async () => {
    await withStub(
      {
        runs: [{ out: "bunx missing" }, { out: "npm missing" }],
        pairs: [{ status: "pending" }, { status: "pending" }, { status: "pending" }, { status: "pending" }],
      },
      async (next) => {
        await expect(
          claimPush({
            platform: { fetch: next.fetch },
            server: { type: "http", http: { url: "http://localhost:4096" } } as any,
            token: "ptok_1",
            relay: "http://localhost:8787",
            pairId: "pair_1",
          }),
        ).rejects.toThrow("Push pairing command failed via npx: npm missing")
      },
    )
  })

  test("surfaces websocket constructor failures as host install failures", async () => {
    await withStub(
      {
        runs: [{ boom: "The string did not match the expected pattern." }],
      },
      async (next) => {
        await expect(
          claimPush({
            platform: { fetch: next.fetch },
            server: { type: "http", http: { url: "http://localhost:4096" } } as any,
            token: "ptok_1",
          }),
        ).rejects.toThrow("Push pairing command stream could not connect")
      },
    )
  })
})

describe("runPushSetup", () => {
  test("surfaces a structured permission issue", async () => {
    const platform = {
      fetch: globalThis.fetch,
      pushState: () => push({ permission: "denied", allowed: false, registered: false }),
      getPushState: async () => push({ permission: "denied", allowed: false, registered: false }),
      getPushPairing: async () => undefined,
      beginPushPairing: async () => {
        throw new Error("should not start pairing")
      },
    }

    await runPushSetup({
      platform,
      server: { type: "http", http: { url: "http://localhost:4096" } } as any,
      ask: false,
    }).then(
      () => {
        throw new Error("expected push setup to fail")
      },
      (err) => {
        expect(err).toBeInstanceOf(PushFail)
        expect((err as PushFail).issue.code).toBe("permission_denied")
      },
    )
  })

  test("surfaces host install failures without entering a retry loop", async () => {
    await withStub(
      {
        runs: [{ out: "bunx missing" }, { out: "npx missing" }],
        pairs: [{ status: "pending" }, { status: "pending" }, { status: "pending" }, { status: "pending" }],
      },
      async (next) => {
        const seen: string[] = []
        const platform = {
          fetch: next.fetch,
          pushState: () => push(),
          getPushState: async () => push(),
          getPushPairing: async () => undefined,
          beginPushPairing: async () => ({
            id: "pair_1",
            status: "pending" as const,
            token: "tok_1",
            command: "bunx @whispercode/opencode-push pair --pair tok_1",
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
        }

        await runPushSetup({
          platform,
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          relay: "http://localhost:8787",
          onPair: (value) => {
            if (value.command) {
              seen.push(value.command)
            }
          },
        }).then(
          () => {
            throw new Error("expected push setup to fail")
          },
          (err) => {
            expect(err).toBeInstanceOf(PushFail)
            expect((err as PushFail).issue.code).toBe("host_install_failed")
            expect((err as PushFail).issue.message).toContain("npx missing")
          },
        )

        expect(seen[0]).toBe(pairPush("tok_1", "http://localhost:8787"))
      },
    )
  })

  test("activates the host plugin before running the paired claim", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "claimed" }],
      },
      async (next) => {
        const platform = {
          fetch: next.fetch,
          pushState: () => push(),
          getPushState: async () => push(),
          getPushPairing: async () => ({
            id: "pair_1",
            status: "active" as const,
            channel: "ch_1",
            device: "dev_1",
          }),
          beginPushPairing: async () => ({
            id: "pair_1",
            status: "pending" as const,
            token: "tok_1",
            command: "bunx @whispercode/opencode-push pair --pair tok_1",
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
        }

        const res = await runPushSetup({
          platform,
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          relay: "http://localhost:8787",
        })

        expect(res.ok).toBe(true)
        expect(next.patches).toEqual([{ plugin: [PushPlugin.spec] }])
        expect(next.bodies).toEqual([JSON.stringify({ plugin: [PushPlugin.spec] })])

        const patch = next.reqs.findIndex((item) => item.url.endsWith("/global/config") && item.method === "PATCH")
        const dispose = next.reqs.findIndex((item) => item.url.endsWith("/global/dispose") && item.method === "POST")
        const pty = next.reqs.findIndex((item) => item.url.endsWith("/pty") && item.method === "POST")

        expect(patch).toBeGreaterThanOrEqual(0)
        expect(dispose).toBeGreaterThan(patch)
        expect(pty).toBeGreaterThan(dispose)
      },
    )
  })

  test("recycles the host even when the plugin is already configured", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "claimed" }],
        cfg: { plugin: [PushPlugin.spec] },
      },
      async (next) => {
        const platform = {
          fetch: next.fetch,
          pushState: () => push(),
          getPushState: async () => push(),
          getPushPairing: async () => ({
            id: "pair_1",
            status: "active" as const,
            channel: "ch_1",
            device: "dev_1",
          }),
          beginPushPairing: async () => ({
            id: "pair_1",
            status: "pending" as const,
            token: "tok_1",
            command: "bunx @whispercode/opencode-push pair --pair tok_1",
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
        }

        const res = await runPushSetup({
          platform,
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          relay: "http://localhost:8787",
        })

        expect(res.ok).toBe(true)
        expect(next.patches).toEqual([])

        const dispose = next.reqs.findIndex((item) => item.url.endsWith("/global/dispose") && item.method === "POST")
        const pty = next.reqs.findIndex((item) => item.url.endsWith("/pty") && item.method === "POST")

        expect(dispose).toBeGreaterThanOrEqual(0)
        expect(pty).toBeGreaterThan(dispose)
      },
    )
  })

  test("finishes setup from relay credentials when native pair polling lags", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [
          { status: "claimed" },
          {
            status: "active",
            channel_id: "ch_1",
            device_id: "dev_1",
            device_secret: "sec_1",
          },
        ],
        cfg: { plugin: [PushPlugin.spec] },
      },
      async (next) => {
        const set: Array<{ channel: string; device?: string; secret?: string }> = []
        const platform = {
          fetch: next.fetch,
          pushState: () => push(),
          getPushState: async () => push(),
          getPushPairing: async () => ({
            id: "pair_1",
            status: "claimed" as const,
          }),
          setPushCredentials: async (input: { channel: string; device?: string; secret?: string }) => {
            set.push(input)
            return {
              ...push({ paired: true }),
              channel: input.channel,
            }
          },
          beginPushPairing: async () => ({
            id: "pair_1",
            status: "pending" as const,
            token: "tok_1",
            command: "bunx @whispercode/opencode-push pair --pair tok_1",
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
        }

        const res = await runPushSetup({
          platform,
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          relay: "http://localhost:8787",
        })

        expect(res.ok).toBe(true)
        expect(res.pair.status).toBe("active")
        expect(set).toEqual([{ channel: "ch_1", device: "dev_1", secret: "sec_1" }])
      },
    )
  })

  test("replaces an existing push entry when the configured spec differs", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "claimed" }],
        cfg: { plugin: ["@whisperopencode/push"] },
      },
      async (next) => {
        const platform = {
          fetch: next.fetch,
          pushState: () => push(),
          getPushState: async () => push(),
          getPushPairing: async () => ({
            id: "pair_1",
            status: "active" as const,
            channel: "ch_1",
            device: "dev_1",
          }),
          beginPushPairing: async () => ({
            id: "pair_1",
            status: "pending" as const,
            token: "tok_1",
            command: "bunx @whispercode/opencode-push pair --pair tok_1",
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
        }

        const res = await runPushSetup({
          platform,
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          relay: "http://localhost:8787",
        })

        expect(res.ok).toBe(true)
        expect(next.patches).toEqual([{ plugin: [PushPlugin.spec] }])
        expect(next.bodies).toEqual([JSON.stringify({ plugin: [PushPlugin.spec] })])
      },
    )
  })

  test("surfaces a missing token issue when begin pairing fails before a token exists", async () => {
    let state = push()
    const platform = {
      fetch: globalThis.fetch,
      pushState: () => state,
      getPushState: async () => state,
      getPushPairing: async () => undefined,
      beginPushPairing: async () => {
        state = {
          ...state,
          diag: {
            token: false,
            lastCode: "missing_token",
          },
        }
        throw new Error("APNs token unavailable")
      },
    }

    await runPushSetup({
      platform,
      server: { type: "http", http: { url: "http://localhost:4096" } } as any,
    }).then(
      () => {
        throw new Error("expected push setup to fail")
      },
      (err) => {
        expect(err).toBeInstanceOf(PushFail)
        expect((err as PushFail).issue.code).toBe("missing_token")
      },
    )
  })

  test("surfaces relay rate limits during finish setup", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "pair"\n}' }],
        pairs: [{ status: "claimed" }],
        cfg: { plugin: [PushPlugin.spec] },
      },
      async (next) => {
        const platform = {
          fetch: next.fetch,
          pushState: () => push(),
          getPushState: async () => push(),
          getPushPairing: async () => {
            throw new Error("rate_limited")
          },
          beginPushPairing: async () => ({
            id: "pair_1",
            status: "pending" as const,
            token: "tok_1",
            command: "bunx @whispercode/opencode-push pair --pair tok_1",
            expires: new Date(Date.now() + 60_000).toISOString(),
          }),
        }

        await runPushSetup({
          platform,
          server: { type: "http", http: { url: "http://localhost:4096" } } as any,
          relay: "http://localhost:8787",
        }).then(
          () => {
            throw new Error("expected push setup to fail")
          },
          (err) => {
            expect(err).toBeInstanceOf(PushFail)
            expect((err as PushFail).issue.code).toBe("relay_rate_limited")
            expect((err as PushFail).issue.message).toBe(
              "Push relay is temporarily rate limited. Wait a minute and try again.",
            )
          },
        )
      },
    )
  })
})

describe("pushIssue", () => {
  test("surfaces native APNs failures from current push diagnostics", () => {
    const issue = pushIssue({
      ...push({ allowed: true, registered: false }),
      diag: {
        token: false,
        lastCode: "apns_register_failed",
      },
    })

    expect(issue?.code).toBe("apns_register_failed")
  })

  test("surfaces relay rate limits from native diagnostics", () => {
    const issue = pushIssue({
      ...push({ allowed: true, registered: true }),
      diag: {
        token: true,
        lastCode: "relay_rate_limited",
        lastError: "rate_limited",
      },
    })

    expect(issue?.code).toBe("relay_rate_limited")
    expect(issue?.message).toBe("Push relay is temporarily rate limited. Wait a minute and try again.")
  })
})

describe("mergePushIssue", () => {
  test("drops stale permission issues once iPhone notification access is restored", () => {
    const issue = mergePushIssue(
      {
        code: "permission_denied",
        message: "Turn on notifications for WhisperCode in the iPhone Settings app.",
        action: "settings",
      },
      push(),
    )

    expect(issue).toBeUndefined()
  })

  test("preserves host install failures until the user retries", () => {
    const issue = mergePushIssue(
      {
        code: "host_install_failed",
        message: "Push pairing command failed via bunx: bunx missing",
        action: "retry",
      },
      push(),
    )

    expect(issue?.code).toBe("host_install_failed")
  })
})
