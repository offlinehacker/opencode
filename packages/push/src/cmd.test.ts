import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { install, status, test as ping, unpair, type Opts } from "./cmd"

const base = (): Opts => ({ plugin: "@whispercode/opencode-push@0.x", json: true })

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), "push-"))
}

afterEach(() => {
  delete process.env.OPENCODE_TEST_HOME
})

describe("push cmd", () => {
  test("installs local mode without pair token", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const res = await install(base())
    expect(res.mode).toBe("local")
  })

  test("claims relay pair and stores relay state", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const seen: Array<Record<string, unknown>> = []
    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (req: Request): Promise<Response> => {
        const body = (await req.json()) as Record<string, unknown>
        seen.push(body)
        return Response.json({
          relay_url: `http://127.0.0.1:${port}`,
          channel_id: "ch_1",
          channel_secret: "sec_1",
        })
      },
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next

    const res = await install({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}`, server: "macbook" })
    expect(res.mode).toBe("relay")
    expect(res.channel).toBe("ch_1")
    expect(seen[0]?.pair_token).toBe("ptok_1")
    await srv.stop()
  })

  test("status reports relay diagnostics", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (): Promise<Response> =>
        Response.json({
          relay_url: `http://127.0.0.1:${port}`,
          channel_id: "ch_1",
          channel_secret: "sec_1",
        }),
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next
    await install({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}` })
    const res = await status(base())
    expect(res.mode).toBe("relay")
    expect(res.channel).toBe("ch_1")
    await srv.stop()
  })

  test("test pings the relay when paired", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    const seen: string[] = []
    let port = 0
    const srv = Bun.serve({
      port: 0,
      fetch: async (req: Request): Promise<Response> => {
        seen.push(new URL(req.url).pathname)
        return Response.json(
          new URL(req.url).pathname === "/v1/pair/claim"
            ? {
                relay_url: `http://127.0.0.1:${port}`,
                channel_id: "ch_1",
                channel_secret: "sec_1",
              }
            : { ok: true },
        )
      },
    })
    const next = srv.port
    if (!next) throw new Error("missing test port")
    port = next
    await install({ ...base(), pair: "ptok_1", relay: `http://127.0.0.1:${port}` })
    const res = await ping(base())
    expect(res.result).toBe("ok")
    expect(seen.includes("/v1/channel/checkin")).toBe(true)
    await srv.stop()
  })

  test("unpair removes files", async () => {
    process.env.OPENCODE_TEST_HOME = await tmp()
    await install(base())
    const res = await unpair(base())
    expect(res.cmd).toBe("unpair")
  })
})
