import fs from "fs/promises"
import os from "os"
import pkg from "../package.json" with { type: "json" }
import { checkin } from "./checkin.js"
import { cut, merge, name, read, write } from "./config.js"
import { logFile, stateFile } from "./path.js"
import { claim, devices as relayDevices, publish, removeDevice as relayRemoveDevice } from "./relay.js"
import { append, load, next, save, type Data } from "./state.js"

export type Cmd = "install" | "pair" | "status" | "test" | "unpair" | "devices" | "remove-device"

export type Opts = {
  plugin: string
  json: boolean
  pair?: string
  relay?: string
  server?: string
  device?: string
}

export async function run(cmd: string | undefined, opts: Opts) {
  switch ((cmd ?? "status") as Cmd) {
    case "install":
      return install(opts)
    case "pair":
      return pair(opts)
    case "status":
      return status(opts)
    case "test":
      return test(opts)
    case "unpair":
      return unpair(opts)
    case "devices":
      return listDevices(opts)
    case "remove-device":
      return removeDevice(opts)
    default:
      help()
      process.exitCode = 1
  }
}

export async function install(opts: Opts) {
  const cfg = await read()
  const list = merge(cfg.data.plugin ?? [], opts.plugin)
  const data = await load()

  if (opts.pair) {
    await claimPair(opts, data)
  }

  data.updated_at = Date.now()
  await save(data)

  if (opts.pair && data.mode === "relay" && data.relay) {
    await checkin(data, "install")
  }

  await write(cfg.src, cfg.text, list)

  return out(opts, {
    ok: true,
    cmd: "install",
    plugin: opts.plugin,
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    config: cfg.src,
    state: stateFile(),
  })
}

export async function pair(opts: Opts) {
  if (!opts.pair) {
    return out(opts, { ok: false, error: "missing_pair_token" })
  }

  const data = await load()
  await claimPair(opts, data)
  data.updated_at = Date.now()
  await save(data)

  if (data.mode === "relay" && data.relay) {
    await checkin(data, "pair")
  }

  return out(opts, {
    ok: true,
    cmd: "pair",
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    state: stateFile(),
  })
}

export async function status(opts: Opts) {
  const cfg = await read()
  const pkg = name(opts.plugin)
  const list = cfg.data.plugin ?? []
  const data = await load()
  const log = await fs
    .stat(logFile())
    .then((x) => x.size)
    .catch(() => 0)

  return out(opts, {
    ok: true,
    cmd: "status",
    plugin: pkg,
    installed: list.some((item) => name(item) === pkg),
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    checked: data.relay?.checked ?? null,
    result: data.relay?.result ?? null,
    reason: data.relay?.reason ?? null,
    error: data.relay?.err ?? null,
    config: cfg.src,
    state: stateFile(),
    log: logFile(),
    bytes: log,
    last: data.last ?? null,
  })
}

export async function test(opts: Opts) {
  const data = await load()
  const item = next("test")
  let sent: "accepted" | "suppressed" | undefined
  data.last = item
  data.updated_at = Date.now()
  await append(item)

  if (data.mode === "relay" && data.relay) {
    await checkin(data, "test")
    if (data.relay.result !== "failed") {
      const relay = data.relay
      await publish(data, item)
        .then((res) => {
          sent = res.suppressed ? "suppressed" : "accepted"
          data.relay = {
            ...relay,
            checked: Date.now(),
            result: "ok",
            reason: res.reason,
            delivery: res.deliveries?.[0]?.delivery_id,
            err: undefined,
          }
        })
        .catch((err: unknown) => {
          data.relay = {
            ...relay,
            checked: Date.now(),
            result: "failed",
            err: err instanceof Error ? err.message : String(err),
          }
        })
    }
  }

  await save(data)

  return out(opts, {
    ok: true,
    cmd: "test",
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    checked: data.relay?.checked ?? null,
    result: data.relay?.result ?? null,
    publish: sent ?? null,
    reason: data.relay?.reason ?? null,
    delivery: data.relay?.delivery ?? null,
    error: data.relay?.err ?? null,
    state: stateFile(),
    log: logFile(),
    item,
  })
}

export async function unpair(opts: Opts) {
  const cfg = await read()
  const list = cut(cfg.data.plugin ?? [], name(opts.plugin))
  await write(cfg.src, cfg.text, list)
  await fs.rm(stateFile(), { force: true }).catch(() => undefined)
  await fs.rm(logFile(), { force: true }).catch(() => undefined)

  return out(opts, {
    ok: true,
    cmd: "unpair",
    config: cfg.src,
    state: stateFile(),
    log: logFile(),
  })
}

export async function listDevices(opts: Opts) {
  const data = await load()
  if (data.mode !== "relay" || !data.relay) {
    return out(opts, { ok: false, error: "not_paired" })
  }
  const list = await relayDevices(data)
  return out(opts, { ok: true, cmd: "devices", devices: list })
}

export async function removeDevice(opts: Opts) {
  const data = await load()
  if (data.mode !== "relay" || !data.relay) {
    return out(opts, { ok: false, error: "not_paired" })
  }
  if (!opts.device) {
    return out(opts, { ok: false, error: "missing_device_id" })
  }
  const res = await relayRemoveDevice(data, opts.device)
  return out(opts, { ...res, ok: true, cmd: "remove-device" })
}

export function parse(args: string[]): Opts {
  const opts: Opts = {
    plugin: pkg.name,
    json: false,
  }

  for (let i = 1; i < args.length; i++) {
    const arg = args[i]
    if (arg === "--json") {
      opts.json = true
      continue
    }
    if (arg === "--plugin") {
      const next = args[i + 1]
      if (next) {
        opts.plugin = next
        i += 1
      }
      continue
    }
    if (arg === "--pair") {
      const next = args[i + 1]
      if (next) {
        opts.pair = next
        i += 1
      }
      continue
    }
    if (arg === "--relay") {
      const next = args[i + 1]
      if (next) {
        opts.relay = next
        i += 1
      }
      continue
    }
    if (arg === "--server") {
      const next = args[i + 1]
      if (next) {
        opts.server = next
        i += 1
      }
      continue
    }
    if (arg === "--device") {
      const next = args[i + 1]
      if (next) {
        opts.device = next
        i += 1
      }
      continue
    }
  }

  return opts
}

export function print(opts: Opts, data: Record<string, unknown>) {
  if (opts.json) {
    console.log(JSON.stringify(data, null, 2))
    return
  }

  for (const [key, value] of Object.entries(data)) {
    console.log(`${key}: ${typeof value === "object" ? JSON.stringify(value) : String(value)}`)
  }
}

export function help() {
  console.log(
    "opencode-push <install|pair|status|test|unpair|devices|remove-device> [--pair <token>] [--relay <url>] [--server <label>] [--plugin <spec>] [--device <id>] [--json]",
  )
}

async function claimPair(opts: Opts, data: Data) {
  const server = opts.server ?? os.hostname()
  const root = opts.relay ?? envRelay()
  const existing =
    data.mode === "relay" && data.relay && data.relay.url === root
      ? { channel_id: data.relay.channel, channel_secret: data.relay.secret }
      : undefined
  const res = await claim(root, opts.pair!, server, pkg.version, existing)
  data.mode = "relay"
  data.relay = {
    url: res.relay_url,
    channel: res.channel_id,
    secret: res.channel_secret,
    server,
  }
}

function envRelay() {
  return (
    process.env.WHISPEROPENCODE_PUSH_RELAY_URL ??
    process.env.OPENCODE_PUSH_RELAY_URL ??
    "https://whisper.clankercontext.com"
  )
}

function out(opts: Opts, data: Record<string, unknown>) {
  print(opts, data)
  return data
}
