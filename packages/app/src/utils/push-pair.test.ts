import { describe, expect, test } from "bun:test"
import { claimPush, fetchWithTimeout, mergePushIssue, PushFail, pushIssue, runPushSetup } from "./push-pair"
import { pairPush } from "./push-plugin"

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

type Pair = {
  status?: "pending" | "claimed" | "active" | "expired" | "failed"
  message?: string
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

function stub(input: { runs: Run[]; pairs?: Pair[] }) {
  const cmds: Cmd[] = []
  const urls: string[] = []
  const runs = new Map<string, Run>()
  const OriginalSocket = globalThis.WebSocket
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
    const text = String(url)
    urls.push(text)

    if (text.endsWith("/path")) {
      return Response.json({ state: "/tmp/opencode", directory: "/repo/demo" })
    }

    if (text.endsWith("/pty")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { command?: string; args?: string[]; cwd?: string }
      id += 1
      const key = `pty_${id}`
      cmds.push({ command: body.command ?? "", args: body.args ?? [], cwd: body.cwd })
      runs.set(key, input.runs[id - 1] ?? input.runs.at(-1) ?? {})
      return Response.json({ id: `pty_${id}` })
    }

    if (text.includes("/pty/") && text.endsWith("/result")) {
      throw new Error("unexpected /pty/:id/result request")
    }

    if (text.includes("/v1/pair/")) {
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
    restore() {
      globalThis.WebSocket = OriginalSocket
    },
  }
}

async function withStub<T>(input: { runs: Run[]; pairs?: Pair[] }, fn: (next: ReturnType<typeof stub>) => Promise<T>) {
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
  test("accepts installs via websocket output without requesting a PTY result", async () => {
    await withStub(
      {
        runs: [{ close: false }],
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

        expect(res).toEqual({ ok: true })
        expect(next.cmds.map((item) => item.command)).toEqual(["npx"])
        expect(next.cmds[0]?.args).toContain("--prefix")
        expect(next.cmds[0]?.args).toContain("--json")
        expect(next.cmds[0]?.cwd).toBe("/repo/demo")
        expect(next.urls.some((item) => item.endsWith("/result"))).toBe(false)
      },
    )
  })

  test("waits for relay claim after a successful install response", async () => {
    await withStub(
      {
        runs: [{ out: '{\n  "ok": true,\n  "cmd": "install"\n}' }],
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

        expect(res).toEqual({ ok: true })
        expect(next.cmds.map((item) => item.command)).toEqual(["npx"])
      },
    )
  })

  test("falls back to bunx when the first PTY closes before the relay claims", async () => {
    await withStub(
      {
        runs: [{ out: "npx failed" }, { close: false }],
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

        expect(res).toEqual({ ok: true })
        expect(next.cmds.map((item) => item.command)).toEqual(["npx", "bunx"])
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
        runs: [{ out: "npm missing" }, { out: "bunx missing" }],
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
        ).rejects.toThrow("Push pairing command failed via bunx: bunx missing")
      },
    )
  })

  test("surfaces websocket constructor failures as host install failures", async () => {
    await withStub(
      {
        runs: [{ boom: "The string did not match the expected pattern." }],
        pairs: [{ status: "pending" }],
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
        runs: [{ out: "npx missing" }, { out: "bunx missing" }],
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
            command: "bunx @whispercode/opencode-push install --pair tok_1",
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
            expect((err as PushFail).issue.message).toContain("bunx missing")
          },
        )

        expect(seen[0]).toBe(pairPush("tok_1", "http://localhost:8787"))
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
