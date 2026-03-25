import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import type { Data } from "./state"

let hits = 0
let fail: Error | undefined
let hold: Promise<void> | undefined

mock.module("./relay.js", () => ({
  checkin: async () => {
    hits += 1
    if (hold) await hold
    if (fail) throw fail
    return { ok: true }
  },
}))

type Check = typeof import("./checkin")
type Path = typeof import("./path")
type State = typeof import("./state")

let check: Check
let state: State
let paths: Path

const dirs: string[] = []

beforeAll(async () => {
  check = await import("./checkin")
  state = await import("./state")
  paths = await import("./path")
})

afterEach(async () => {
  delete process.env.OPENCODE_TEST_HOME
  hits = 0
  fail = undefined
  hold = undefined

  for (const dir of dirs.splice(0)) {
    const root = path.join(dir, ".local", "state", "opencode")
    await fs.chmod(root, 0o700).catch(() => undefined)
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

function data(): Data {
  return {
    v: 1,
    mode: "relay",
    root: {},
    cool: {},
    relay: {
      url: "https://relay.test",
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
    const lock = paths.checkinLockFile()
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await stale(lock)

    const next = data()
    const res = await check.checkin(next, "test")
    const saved = await state.load()
    const found = await fs.stat(lock).catch(() => undefined)

    expect(res).toEqual({ status: "ok" })
    expect(hits).toBe(1)
    expect(saved.relay?.result).toBe("ok")
    expect(saved.relay?.checked).toEqual(expect.any(Number))
    expect(found).toBeUndefined()
  })

  test("returns locked when stale lock cleanup fails", async () => {
    const dir = await home()
    const lock = paths.checkinLockFile()
    const root = path.join(dir, ".local", "state", "opencode")
    await fs.mkdir(root, { recursive: true })
    await stale(lock)
    await fs.chmod(root, 0o500)

    const res = await check.checkin(data(), "test")

    expect(res).toEqual({ status: "skip", reason: "locked" })
    expect(hits).toBe(0)
  })

  test("returns locked when a fresh lock already exists", async () => {
    await home()
    const lock = paths.checkinLockFile()
    await fs.mkdir(path.dirname(lock), { recursive: true })
    await fs.writeFile(lock, "123")

    const res = await check.checkin(data(), "test")

    expect(res).toEqual({ status: "skip", reason: "locked" })
    expect(hits).toBe(0)
  })

  test("waits for an active lock and reuses the fresh result", async () => {
    await home()
    const lock = paths.checkinLockFile()

    let open!: () => void
    hold = new Promise<void>((done) => {
      open = done
    })

    const one = check.checkin(data(), "one")
    await seen(lock)
    const two = check.checkin(data(), "two")
    open()

    const [first, second] = await Promise.all([one, two])

    expect(first).toEqual({ status: "ok" })
    expect(second).toEqual({ status: "skip", reason: "fresh_locked" })
    expect(hits).toBe(1)
  })

  test("releases the lock when relay checkin fails", async () => {
    await home()
    const lock = paths.checkinLockFile()
    fail = new Error("boom")

    const res = await check.checkin(data(), "test")
    const found = await fs.stat(lock).catch(() => undefined)

    expect(res).toEqual({ status: "err", reason: "boom" })
    expect(hits).toBe(1)
    expect(found).toBeUndefined()
  })
})
