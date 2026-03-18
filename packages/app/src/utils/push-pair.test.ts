import { describe, expect, test } from "bun:test"
import { claimPush, fetchWithTimeout } from "./push-pair"

type Run = {
  code: number
  out: string
}

type Cmd = {
  command: string
  args: string[]
}

type Pair = {
  status?: "pending" | "claimed" | "active" | "expired" | "failed"
  message?: string
}

function stub(input: { runs: Run[]; pairs?: Pair[] }) {
  const cmds: Cmd[] = []
  let id = 0
  let pair = 0

  const fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const text = String(url)

    if (text.endsWith("/path")) {
      return Response.json({ state: "/tmp/opencode" })
    }

    if (text.endsWith("/pty")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as { command?: string; args?: string[] }
      cmds.push({ command: body.command ?? "", args: body.args ?? [] })
      id += 1
      return Response.json({ id: `pty_${id}` })
    }

    if (text.includes("/pty/") && text.endsWith("/result")) {
      const match = text.match(/pty_(\d+)/)
      const idx = Math.max(0, Number(match?.[1] ?? "1") - 1)
      const run = input.runs[idx] ?? input.runs.at(-1) ?? { code: 1, out: "" }
      return Response.json({
        status: "exited",
        exitCode: run.code,
        output: run.out,
      })
    }

    if (text.includes("/v1/pair/")) {
      const item = input.pairs?.[pair] ?? input.pairs?.at(-1) ?? { status: "pending" }
      pair += 1
      return Response.json(item)
    }

    return new Response("not found", { status: 404 })
  }) as typeof globalThis.fetch

  return { fetch, cmds }
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
  test("accepts zero-exit installs only after the relay is claimed", async () => {
    const next = stub({
      runs: [{ code: 0, out: "" }],
      pairs: [{ status: "claimed" }],
    })

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
  })

  test("falls back to bunx when npx fails", async () => {
    const next = stub({
      runs: [
        { code: 1, out: "npx failed" },
        { code: 0, out: "" },
      ],
      pairs: [{ status: "active" }],
    })

    const res = await claimPush({
      platform: { fetch: next.fetch },
      server: { type: "http", http: { url: "http://localhost:4096" } } as any,
      token: "ptok_1",
      relay: "http://localhost:8787",
      pairId: "pair_1",
    })

    expect(res).toEqual({ ok: true })
    expect(next.cmds.map((item) => item.command)).toEqual(["npx", "bunx"])
  })

  test("surfaces relay terminal states as hard failures", async () => {
    const next = stub({
      runs: [{ code: 0, out: "" }],
      pairs: [{ status: "failed", message: "pair_failed" }],
    })

    await expect(
      claimPush({
        platform: { fetch: next.fetch },
        server: { type: "http", http: { url: "http://localhost:4096" } } as any,
        token: "ptok_1",
        relay: "http://localhost:8787",
        pairId: "pair_1",
      }),
    ).rejects.toThrow("pair_failed")
  })

  test("includes command output when both runners fail", async () => {
    const next = stub({
      runs: [
        { code: 1, out: "npm missing" },
        { code: 1, out: "bunx missing" },
      ],
    })

    await expect(
      claimPush({
        platform: { fetch: next.fetch },
        server: { type: "http", http: { url: "http://localhost:4096" } } as any,
        token: "ptok_1",
      }),
    ).rejects.toThrow("Push pairing command failed via bunx: bunx missing")
  })
})
