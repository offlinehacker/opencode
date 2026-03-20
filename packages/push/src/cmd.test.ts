import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { install, status, test as ping, unpair, type Opts } from "./cmd"

const base = (): Opts => ({ plugin: "@whisperopencode/push", json: true })

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

  test("rerun rewrites pinned config to unpinned spec", async () => {
    const dir = await tmp()
    process.env.OPENCODE_TEST_HOME = dir
    const cfg = path.join(dir, ".config", "opencode", "opencode.jsonc")
    await fs.mkdir(path.dirname(cfg), { recursive: true })
    await fs.writeFile(
      cfg,
      JSON.stringify(
        {
          plugin: ["foo@1.0.0", "@whisperopencode/push@0.2.0"],
        },
        null,
        2,
      ) + "\n",
    )

    await install(base())

    const text = await fs.readFile(cfg, "utf8")
    expect(text).toContain('"@whisperopencode/push"')
    expect(text).not.toContain("@whisperopencode/push@0.2.0")
    expect(text).toContain('"foo@1.0.0"')
  })
})
