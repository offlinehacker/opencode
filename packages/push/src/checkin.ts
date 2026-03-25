import fs from "fs/promises"
import { checkin as send } from "./relay.js"
import { checkinLockFile, stateDir } from "./path.js"
import { load, save, type Data, type Relay } from "./state.js"

const COOL_MS = 30_000
const LOCK_MS = 20_000
const WAIT_MS = 250
const STEP_MS = 25

function same(a?: Relay, b?: Relay) {
  if (!a || !b) return false
  return a.url === b.url && a.channel === b.channel && a.secret === b.secret
}

function age(value?: number) {
  if (!value) return
  return Date.now() - value
}

function wait(ms: number) {
  return new Promise<void>((done) => setTimeout(done, ms))
}

async function acquire() {
  const file = checkinLockFile()
  const stop = Date.now() + WAIT_MS
  await fs.mkdir(stateDir(), { recursive: true }).catch(() => undefined)

  for (;;) {
    const found = await fs
      .stat(file)
      .then((info) => info)
      .catch(() => undefined)
    if (found && Date.now() - found.mtimeMs > LOCK_MS) {
      const gone = await fs
        .rm(file, { force: true })
        .then(() => true)
        .catch(() => false)
      if (!gone) return
      continue
    }

    const lock = await fs
      .open(file, "wx")
      .then((item) => item)
      .catch((err: unknown) => {
        if ((err as NodeJS.ErrnoException | undefined)?.code === "EEXIST") return
        throw err
      })
    if (lock) {
      await lock.writeFile(String(process.pid))
      return async () => {
        await lock.close().catch(() => undefined)
        await fs.rm(file, { force: true }).catch(() => undefined)
      }
    }

    if (Date.now() >= stop) return
    await wait(STEP_MS)
  }
}

async function fresh(relay?: Relay) {
  if (!relay?.checked) return
  const next = age(relay.checked)
  if (next === undefined || next >= COOL_MS) return
  return next
}

async function apply(data: Data, relay: Relay) {
  const current = await load()
  if (same(current.relay, relay)) {
    current.relay = relay
    await save(current)
  } else {
    data.relay = relay
    await save(data)
  }
}

export async function checkin(data: Data, _source: string) {
  const relay = data.relay
  if (data.mode !== "relay" || !relay) {
    return {
      status: "skip" as const,
      reason: "not_relay",
    }
  }

  const current = await load()
  const seen = same(current.relay, relay) ? current.relay : relay
  const recent = await fresh(seen)
  if (recent !== undefined) {
    return {
      status: "skip" as const,
      reason: "fresh",
    }
  }

  const release = await acquire()
  if (!release) {
    return {
      status: "skip" as const,
      reason: "locked",
    }
  }

  try {
    const latest = await load()
    const next = same(latest.relay, relay) ? latest.relay : relay
    const again = await fresh(next)
    if (again !== undefined) {
      return {
        status: "skip" as const,
        reason: "fresh_locked",
      }
    }

    await send(data)
    const ok = {
      ...relay,
      checked: Date.now(),
      result: "ok" as const,
      reason: undefined,
      err: undefined,
    }
    await apply(data, ok)
    data.relay = ok
    return {
      status: "ok" as const,
    }
  } catch (err) {
    const fail = {
      ...relay,
      checked: Date.now(),
      result: "failed" as const,
      err: err instanceof Error ? err.message : String(err),
    }
    await apply(data, fail)
    data.relay = fail
    return {
      status: "err" as const,
      reason: fail.err,
    }
  } finally {
    await release()
  }
}
