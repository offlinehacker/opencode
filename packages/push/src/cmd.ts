import fs from "fs/promises"
import os from "os"
import pkg from "../package.json"
import { cut, merge, name, read, write } from "./config"
import { logFile, stateFile } from "./path"
import { checkin, claim } from "./relay"
import { append, load, next, save } from "./state"

export type Cmd = "install" | "status" | "test" | "unpair"

export type Opts = {
  plugin: string
  json: boolean
  pair?: string
  relay?: string
  server?: string
}

export async function run(cmd: string | undefined, opts: Opts) {
  switch ((cmd ?? "status") as Cmd) {
    case "install":
      return install(opts)
    case "status":
      return status(opts)
    case "test":
      return test(opts)
    case "unpair":
      return unpair(opts)
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
    const server = opts.server ?? os.hostname()
    const root = opts.relay ?? envRelay()
    const res = await claim(root, opts.pair, server, pkg.version)
    data.mode = "relay"
    data.relay = {
      url: res.relay_url,
      channel: res.channel_id,
      secret: res.channel_secret,
      server,
    }
  }

  data.updated_at = Date.now()
  await save(data)
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
  data.last = item
  data.updated_at = Date.now()
  await append(item)

  if (data.mode === "relay" && data.relay) {
    const relay = data.relay
    await checkin(data)
      .then(() => {
        data.relay = {
          ...relay,
          checked: Date.now(),
          result: "ok",
          reason: undefined,
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

  await save(data)

  return out(opts, {
    ok: true,
    cmd: "test",
    mode: data.mode,
    relay: data.relay?.url ?? null,
    channel: data.relay?.channel ?? null,
    checked: data.relay?.checked ?? null,
    result: data.relay?.result ?? null,
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

export function parse(args: string[]): Opts {
  const opts: Opts = {
    plugin: "@whispercode/opencode-push@0.x",
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
    "opencode-push <install|status|test|unpair> [--pair <token>] [--relay <url>] [--server <label>] [--plugin <spec>] [--json]",
  )
}

function envRelay() {
  return process.env.WHISPERCODE_PUSH_RELAY_URL ?? process.env.OPENCODE_PUSH_RELAY_URL ?? "https://push.whispercode.dev"
}

function out(opts: Opts, data: Record<string, unknown>) {
  print(opts, data)
  return data
}
