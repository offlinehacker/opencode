import { createAdapter, type Dial } from "./apns"
import { log } from "./log"
import { file as dbFile } from "./path"
import { createRateLimiter, defaultIpExtractor, defaultRateLimitConfig, type RateLimitConfig } from "./ratelimit"
import { RelayErr, Store, type CleanupConfig, type Send } from "./store"

type Opts = {
  file?: string
  pairMs?: number
  url?: string
  mode?: "mock" | "disabled" | "live"
  team?: string
  kid?: string
  topic?: string
  key?: string
  keyfile?: string
  env?: "sandbox" | "production"
  dial?: Dial
  cleanupIntervalMs?: number // default 3_600_000 (1h), 0 disables
  cleanup?: CleanupConfig
  rateLimit?: RateLimitConfig | false
  ipExtractor?: (req: Request) => string
}

export type Relay = {
  fetch: (req: Request) => Promise<Response>
  stop: () => void
}

export function createRelay(opts?: Opts) {
  const db = new Store({ file: opts?.file ?? dbFile(), pairMs: opts?.pairMs })
  const adapters = {
    sandbox: createAdapter({ ...opts, env: "sandbox" }),
    production: createAdapter({ ...opts, env: "production" }),
  }

  const limiter = opts?.rateLimit !== false ? createRateLimiter(opts?.rateLimit ?? defaultRateLimitConfig()) : null
  const extractIp = opts?.ipExtractor ?? defaultIpExtractor

  const cleanupMs = opts?.cleanupIntervalMs ?? 3_600_000
  let cleanupTimer: ReturnType<typeof setInterval> | undefined
  if (cleanupMs > 0) {
    cleanupTimer = setInterval(() => {
      try {
        const result = db.cleanup(opts?.cleanup)
        const total = result.deliveries + result.pairs + result.devices + result.checkins + result.channels
        if (total > 0) log("info", "cleanup", result as unknown as Record<string, unknown>)
      } catch (err) {
        log("error", "cleanup", { stack: err instanceof Error ? err.stack : String(err) })
      }
    }, cleanupMs)
    cleanupTimer.unref()
  }

  const fetch = async (req: Request) => {
    const t0 = performance.now()
    const method = req.method
    const path = new URL(req.url).pathname

    if (limiter) {
      const ip = extractIp(req)
      const rl = limiter.check(ip, method, path)
      if (!rl.allowed) {
        const retryAfter = Math.ceil(rl.retryAfterMs / 1000)
        log("warn", "rate_limited", { method, path, ip })
        return new Response(JSON.stringify({ error: "rate_limited", retry_after: retryAfter }), {
          status: 429,
          headers: {
            "content-type": "application/json",
            "retry-after": String(retryAfter),
          },
        })
      }
    }

    try {
      const res = await route(db, adapters, req, opts?.url)
      log("info", "request", { method, path, status: res.status, ms: Math.round(performance.now() - t0) })
      return res
    } catch (err) {
      if (err instanceof RelayErr) {
        log("warn", "request", { method, path, status: err.status, code: err.code })
        return out(err.status, { error: err.code, message: err.message })
      }
      const stack = err instanceof Error ? err.stack : String(err)
      log("error", "request", { method, path, stack })
      return out(500, { error: "internal_error" })
    }
  }

  return {
    fetch,
    stop: () => {
      if (cleanupTimer) clearInterval(cleanupTimer)
      limiter?.stop()
      adapters.sandbox.close()
      adapters.production.close()
      db.close()
    },
  } satisfies Relay
}

export function listen(opts?: Opts & { port?: number }) {
  const relay = createRelay(opts)
  const srv = Bun.serve({
    port: opts?.port ?? Number(process.env.PORT || 8787),
    maxRequestBodySize: 64 * 1024,
    fetch: (req, server) => {
      const ip = server.requestIP(req)
      if (ip && !req.headers.get("x-forwarded-for")) {
        const headers = new Headers(req.headers)
        headers.set("x-real-ip", ip.address)
        req = new Request(req, { headers })
      }
      return relay.fetch(req)
    },
  })
  return {
    port: srv.port,
    stop: async () => {
      await srv.stop()
      relay.stop()
    },
  }
}

type Adapters = Record<"sandbox" | "production", ReturnType<typeof createAdapter>>

async function route(db: Store, adapters: Adapters, req: Request, root?: string) {
  const url = new URL(req.url)
  const path = url.pathname
  const base = root ?? url.origin

  if (req.method === "GET" && path === "/health") {
    return out(200, { ok: true })
  }

  if (req.method === "POST" && path === "/v1/pair/start") {
    const body = await json(req)
    need(body, ["apns_token", "device_name", "app_version"])
    return out(200, db.start(body as never, base))
  }

  if (req.method === "GET" && path.startsWith("/v1/pair/")) {
    const pair = decodeURIComponent(path.slice("/v1/pair/".length))
    if (!pair) throw new RelayErr(404, "pair_not_found")
    return out(200, db.pair(pair))
  }

  if (req.method === "POST" && path === "/v1/pair/claim") {
    const body = await json(req)
    need(body, ["pair_token", "plugin_version", "server_label"])
    return out(200, db.claim(body as never, base))
  }

  if (req.method === "POST" && path === "/v1/channel/checkin") {
    const body = await json(req)
    need(body, ["v", "channel_id", "checked_at", "sig"])
    return out(200, db.checkin(body as never))
  }

  if (req.method === "POST" && path === "/v1/events/publish") {
    const body = await json(req)
    need(body, ["v", "channel_id", "event_id", "kind", "occurred_at", "collapse_id", "sig"])
    const result = db.publish(body as never)
    if (result.suppressed || result.sends.length === 0) {
      return out(200, { accepted: true, suppressed: true, reason: result.reason })
    }
    const deliveries = await Promise.all(result.sends.map((send) => deliver(db, adapters, send)))
    return out(200, { accepted: true, device_count: result.sends.length, deliveries })
  }

  if (req.method === "PUT" && path === "/v1/device/token") {
    const body = await json(req)
    need(body, ["channel_id", "device_id", "device_secret", "apns_token"])
    return out(200, db.putToken(body as never))
  }

  if (req.method === "PUT" && path === "/v1/device/preferences") {
    const body = await json(req)
    need(body, ["channel_id", "device_id", "device_secret", "prefs"])
    return out(200, db.putPrefs(body as never))
  }

  if (req.method === "POST" && path === "/v1/device/test") {
    const body = await json(req)
    need(body, ["channel_id", "device_id", "device_secret"])
    const next = db.test(body as never)
    return out(200, await deliver(db, adapters, next))
  }

  if (req.method === "DELETE" && path === "/v1/device") {
    const body = await json(req)
    need(body, ["channel_id", "device_id", "device_secret"])
    return out(200, db.deleteDevice(body as never))
  }

  if (req.method === "POST" && path === "/v1/channel/devices") {
    const body = await json(req)
    need(body, ["channel_id", "channel_secret"])
    return out(200, { devices: db.listDevices(String(body.channel_id), String(body.channel_secret)) })
  }

  if (req.method === "POST" && path === "/v1/channel/device/remove") {
    const body = await json(req)
    need(body, ["channel_id", "channel_secret", "device_id"])
    return out(200, db.removeDevice(String(body.channel_id), String(body.channel_secret), String(body.device_id)))
  }

  return out(404, { error: "not_found" })
}

async function json(req: Request) {
  const type = req.headers.get("content-type") || ""
  if (!type.includes("application/json")) {
    throw new RelayErr(415, "bad_type", "expected application/json")
  }
  const len = Number(req.headers.get("content-length") || 0)
  if (len > 65_536) throw new RelayErr(413, "body_too_large")
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new RelayErr(400, "bad_json")
  }
  return body
}

function need(body: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = body[key]
    if (value === undefined || value === null || value === "") {
      throw new RelayErr(400, "bad_request", `missing ${key}`)
    }
  }
}

function out(code: number, body: Record<string, unknown>) {
  return Response.json(body, { status: code })
}

async function deliver(db: Store, adapters: Adapters, body: Send | Record<string, unknown>) {
  if (body.accepted !== true || body.suppressed === true) {
    return clean(body)
  }

  const id = typeof body.delivery_id === "string" ? body.delivery_id : undefined
  const token = typeof body.token === "string" ? body.token : undefined
  const channel = typeof body.channel_id === "string" ? body.channel_id : undefined
  const kind = typeof body.kind === "string" ? body.kind : undefined
  if (!id || !token || !channel || !kind) {
    return clean(body)
  }

  const collapse = typeof body.collapse_id === "string" ? body.collapse_id : null
  const env = body.apns_env === "sandbox" ? "sandbox" : "production"
  const apns = adapters[env]
  const res = await apns.send({
    delivery: id,
    token,
    channel,
    kind,
    session: typeof body.session_id === "string" ? body.session_id : null,
    collapse,
  })
  db.mark(id, res.sent ? "sent" : "failed", res.code)
  log("info", "deliver", { delivery_id: id, sent: res.sent, mode: res.mode, error: res.code ?? null })
  const did = typeof body.device_id === "string" ? body.device_id : undefined
  if (res.invalid && did) {
    log("warn", "device_deactivated", { device_id: did, error: res.code })
    db.deactivate(did, res.code)
  }
  return {
    ...clean(body),
    sent: res.sent,
    mode: res.mode,
    error: res.code ?? null,
  }
}

function clean(body: Record<string, unknown>) {
  const next = { ...body }
  delete next.token
  delete next.channel_id
  delete next.session_id
  delete next.kind
  delete next.apns_env
  return next
}
