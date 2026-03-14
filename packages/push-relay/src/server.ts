import { createAdapter, type Dial } from "./apns"
import { file as dbFile } from "./path"
import { RelayErr, Store } from "./store"

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
}

export type Relay = {
  fetch: (req: Request) => Promise<Response>
  stop: () => void
}

export function createRelay(opts?: Opts) {
  const db = new Store({ file: opts?.file ?? dbFile(), pairMs: opts?.pairMs })
  const apns = createAdapter(opts)

  const fetch = async (req: Request) => {
    try {
      return await route(db, apns, req, opts?.url)
    } catch (err) {
      if (err instanceof RelayErr) {
        return out(err.status, { error: err.code, message: err.message })
      }
      const message = err instanceof Error ? err.message : String(err)
      return out(500, { error: "internal_error", message })
    }
  }

  return {
    fetch,
    stop: () => db.close(),
  } satisfies Relay
}

export function listen(opts?: Opts & { port?: number }) {
  const relay = createRelay(opts)
  const srv = Bun.serve({
    port: opts?.port ?? Number(process.env.PORT || 8787),
    fetch: relay.fetch,
  })
  return {
    port: srv.port,
    stop: async () => {
      await srv.stop()
      relay.stop()
    },
  }
}

async function route(db: Store, apns: ReturnType<typeof createAdapter>, req: Request, root?: string) {
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
    const next = db.publish(body as never)
    return out(200, await deliver(db, apns, next))
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
    return out(200, await deliver(db, apns, next))
  }

  if (req.method === "DELETE" && path === "/v1/device") {
    const body = await json(req)
    need(body, ["channel_id", "device_id", "device_secret"])
    return out(200, db.deleteDevice(body as never))
  }

  return out(404, { error: "not_found" })
}

async function json(req: Request) {
  const type = req.headers.get("content-type") || ""
  if (!type.includes("application/json")) {
    throw new RelayErr(415, "bad_type", "expected application/json")
  }
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

async function deliver(db: Store, apns: ReturnType<typeof createAdapter>, body: Record<string, unknown>) {
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
  const res = await apns.send({
    delivery: id,
    token,
    channel,
    kind,
    session: typeof body.session_id === "string" ? body.session_id : null,
    collapse,
  })
  db.mark(id, res.sent ? "sent" : "failed", res.code)
  const did = typeof body.device_id === "string" ? body.device_id : undefined
  if (res.invalid && did) {
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
  return next
}
