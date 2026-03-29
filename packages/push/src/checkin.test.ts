import { afterEach, describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { checkin } from "./checkin"
import { checkinLockFile } from "./path"
import { load, type Data } from "./state"

let hits = 0
let fail: string | undefined
let hold: Promise<void> | undefined

const dirs: string[] = []
const srvs: Array<ReturnType<typeof Bun.serve>> = []

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  hits = 0
  fail = undefined
  hold = undefined

  for (const srv of srvs.splice(0)) {
    await srv.stop()
  }

  for (const dir of dirs.splice(0)) {
    const root = path.join(dir, ".local", "state", "opencode")
    await fs.chmod(root, 0o700).catch(() => undefined)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

function data(url: string): Data {
  return {
    v: 1,
    mode: "relay",
    root: {},
    cool: {},
    relay: {
      url,
      channel: "ch_1",
      secret: "sec_1",
    },
  }
}

async function home() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-checkin-"))
  dirs.push(dir)
  process.env.OPENCODE_TEST_HOME = dir
  return dir
}

async function serve() {
  const srv = Bun.serve({
    port: 0,
    fetch: async () => {
      hits += 1
      if (hold) await hold
      if (fail) {
        return Response.json({ error: fail }, { status: 500 })
      }
      return Response.json({ ok: true })
    },
  })
  srvs.push(srv)
  return `http://127.0.0.1:${srv.port}`
}

async function stale(file: string) {
  await fs.writeFile(file, "123")
  const past = new Date(Date.now() - 60_000)
  await fs.utimes(file, past, past)
}

async function seen(file: string) {
  for (let i = 0; i < 50; i++) {
    const found = await fs
      .stat(file)
      .then(() => true)
      .catch(() => false)
    if (found) return
    await new Promise<void>((done) => setTimeout(done, 10))
  }
  throw new Error("lock not found")
}

describe("push checkin", () => {
  test("clears a stale lock and updates relay state", async () => {
    await home()
    const url = await serve()
    const lock = checkinLockFile()
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await stale(lock)

    const res = await checkin(data(url), "test")
    const saved = await load()
    const found = await fs.stat(lock).catch(() => undefined)

    expect(res).toEqual({ status: "ok" })
    expect(hits).toBe(1)
    expect(saved.relay?.result).toBe("ok")
    expect(saved.relay?.checked).toEqual(expect.any(Number))
    expect(found).toBeUndefined()
  })

  test("returns locked when stale lock cleanup fails", async () => {
    const dir = await home()
    const lock = checkinLockFile()
    const root = path.join(dir, ".local", "state", "opencode")
    await fs.mkdir(root, { recursive: true })
    await stale(lock)
    await fs.chmod(root, 0o500)

    const res = await checkin(data("https://relay.test"), "test")

    expect(res).toEqual({ status: "skip", reason: "locked" })
    expect(hits).toBe(0)
  })

  test("returns locked when a fresh lock already exists", async () => {
    await home()
    const lock = checkinLockFile()
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, "123")

    const res = await checkin(data("https://relay.test"), "test")

    expect(res).toEqual({ status: "skip", reason: "locked" })
    expect(hits).toBe(0)
  })

  test("waits for an active lock and reuses the fresh result", async () => {
    await home()
    const url = await serve()
    const lock = checkinLockFile()

    let open!: () => void
    hold = new Promise<void>((done) => {
      open = done
    })

    const one = checkin(data(url), "one")
    await seen(lock)
    const two = checkin(data(url), "two")
    open()

    const [first, second] = await Promise.all([one, two])

    expect(first).toEqual({ status: "ok" })
    expect(second).toEqual({ status: "skip", reason: "fresh_locked" })
    expect(hits).toBe(1)
  })

  test("releases the lock when relay checkin fails", async () => {
    await home()
    const url = await serve()
    const lock = checkinLockFile()
    fail = "boom"

    const res = await checkin(data(url), "test")
    const found = await fs.stat(lock).catch(() => undefined)

    expect(res).toEqual({ status: "err", reason: "boom" })
    expect(hits).toBe(1)
    expect(found).toBeUndefined()
  })
})
