import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { EventEmitter } from "node:events"
import { constants, type ClientHttp2Session, type ClientHttp2Stream, type OutgoingHttpHeaders } from "node:http2"
import { testkey } from "./apns"
import { sign } from "./sign"
import { listen } from "./server"

type Start = {
  pair_id: string
  pair_token: string
  install_command: string
}

type Claim = {
  relay_url: string
  channel_id: string
  channel_secret: string
}

describe("push relay", () => {
  test("pairs, claims, activates, accepts publish, and rejects bad signatures", async () => {
    const env = await setup()
    try {
      const start = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_1",
        device_name: "Alice iPhone",
        app_version: "1.0.0",
      })
      expect(start.install_command).toContain(`--pair ${start.pair_token}`)
      expect(start.install_command).toContain(`--relay ${env.root}`)

      const claim = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: start.pair_token,
        plugin_version: "0.1.0",
        server_label: "Alice MacBook",
      })
      expect(claim.relay_url).toBe(env.root)

      const pending = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(pending.status).toBe("claimed")

      await post(env.root, "/v1/channel/checkin", {
        ...check(claim.channel_id),
        sig: sign(claim.channel_secret, check(claim.channel_id)),
      })

      const active = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(active.status).toBe("active")
      expect(active.channel_id).toBe(claim.channel_id)
      expect(typeof active.device_id).toBe("string")
      expect(typeof active.device_secret).toBe("string")

      await put(env.root, "/v1/device/token", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
        apns_token: "tok_2",
      })

      await put(env.root, "/v1/device/preferences", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
        prefs: {
          complete: false,
          approval: true,
          question: true,
          error: true,
        },
      })

      const body = publish(claim.channel_id)
      const sent = await post(env.root, "/v1/events/publish", {
        ...body,
        sig: sign(claim.channel_secret, body),
      })
      expect(sent.suppressed).toBe(true)
      expect(sent.reason).toBe("preferences")

      const test = await post(env.root, "/v1/device/test", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
      })
      expect(test.accepted).toBe(true)
      expect(test.sent).toBe(true)
      expect(test.mode).toBe("mock")
      expect(typeof test.delivery_id).toBe("string")
      expect(test.collapse_id).toBe("test:device")

      await del(env.root, "/v1/device", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
      })

      const failed = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(failed.status).toBe("failed")

      const follow = publish(claim.channel_id, "evt_2")
      const after = await post(env.root, "/v1/events/publish", {
        ...follow,
        sig: sign(claim.channel_secret, follow),
      })
      expect(after.suppressed).toBe(true)
      expect(after.reason).toBe("no_device")

      const replay = await post(env.root, "/v1/events/publish", {
        ...body,
        sig: sign(claim.channel_secret, body),
      })
      expect(replay.suppressed).toBe(true)
      expect(replay.reason).toBe("replay")

      const res = await fetch(new URL("/v1/channel/checkin", env.root), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...check(claim.channel_id), sig: "bad" }),
      })
      const bad = await res.json()
      expect(res.status).toBe(401)
      expect(bad.error).toBe("bad_signature")
    } finally {
      await env.stop()
    }
  })

  test("marks devices failed when apns rejects the token", async () => {
    const captured: Array<{ collapse: string | null }> = []
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(({ headers }) => {
        captured.push({ collapse: str(headers["apns-collapse-id"]) })
        return { status: 400, body: { reason: "BadDeviceToken" } }
      }),
    })
    try {
      const start = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_bad",
        device_name: "Alice iPhone",
        app_version: "1.0.0",
      })
      const claim = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: start.pair_token,
        plugin_version: "0.1.0",
        server_label: "Alice MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim.channel_id),
        sig: sign(claim.channel_secret, check(claim.channel_id)),
      })

      const active = await get(env.root, `/v1/pair/${start.pair_id}`)
      const body = publish(claim.channel_id, "evt_bad")
      const res = await post(env.root, "/v1/events/publish", {
        ...body,
        sig: sign(claim.channel_secret, body),
      })
      expect(res.sent).toBe(false)
      expect(res.error).toBe("BadDeviceToken")
      expect(captured[0]?.collapse).toBeNull()

      const failed = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(failed.status).toBe("failed")

      const test = await fetch(new URL("/v1/device/test", env.root), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          channel_id: claim.channel_id,
          device_id: String(active.device_id),
          device_secret: String(active.device_secret),
        }),
      })
      expect(test.status).toBe(404)
    } finally {
      await env.stop()
    }
  })
})

function check(channel: string) {
  return {
    v: 1,
    channel_id: channel,
    checked_at: 1,
  }
}

function publish(channel: string, event = "evt_1") {
  return {
    v: 1,
    channel_id: channel,
    event_id: event,
    kind: "complete",
    session_id: "ses_1",
    request_id: null,
    occurred_at: 1,
    collapse_id: "complete:ses_1",
  }
}

async function post<T = Record<string, unknown>>(root: string, next: string, body: Record<string, unknown>) {
  const res = await fetch(new URL(next, root), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & Record<string, unknown>
  if (res.status >= 400) {
    throw new Error(`request failed: ${res.status} ${JSON.stringify(data)}`)
  }
  return data
}

async function get(root: string, next: string) {
  const res = await fetch(new URL(next, root))
  return (await res.json()) as Record<string, unknown>
}

async function put<T = Record<string, unknown>>(root: string, next: string, body: Record<string, unknown>) {
  const res = await fetch(new URL(next, root), {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & Record<string, unknown>
  if (res.status >= 400) {
    throw new Error(`request failed: ${res.status} ${JSON.stringify(data)}`)
  }
  return data
}

async function del<T = Record<string, unknown>>(root: string, next: string, body: Record<string, unknown>) {
  const res = await fetch(new URL(next, root), {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as T & Record<string, unknown>
  if (res.status >= 400) {
    throw new Error(`request failed: ${res.status} ${JSON.stringify(data)}`)
  }
  return data
}

async function tmp() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "push-relay-"))
  return { dir, file: path.join(dir, "relay.sqlite") }
}

async function setup(opts?: Parameters<typeof listen>[0]) {
  const next = await tmp()
  const srv = listen({ file: next.file, mode: "mock", port: 0, ...opts })
  return {
    root: `http://127.0.0.1:${srv.port}`,
    stop: async () => {
      await srv.stop()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

function stub(fn: (input: { headers: OutgoingHttpHeaders; body: string }) => { status: number; body?: unknown }) {
  return () => {
    const ses = new EventEmitter() as ClientHttp2Session & EventEmitter
    ses.close = () => ses
    ses.request = (headers: OutgoingHttpHeaders) => {
      const req = new EventEmitter() as ClientHttp2Stream & EventEmitter
      let body = ""
      req.setEncoding = () => req
      req.end = ((
        chunk?: string | Uint8Array | (() => void),
        _enc?: BufferEncoding | (() => void),
        cb?: () => void,
      ) => {
        if (typeof chunk === "string") body += chunk
        else if (chunk instanceof Uint8Array) body += Buffer.from(chunk).toString("utf8")
        queueMicrotask(() => {
          const res = fn({ headers, body })
          req.emit("response", { [constants.HTTP2_HEADER_STATUS]: res.status })
          if (res.body !== undefined) req.emit("data", JSON.stringify(res.body))
          req.emit("end")
          cb?.()
        })
        return req
      }) as ClientHttp2Stream["end"]
      return req
    }
    return ses
  }
}

function str(value: OutgoingHttpHeaders[string]) {
  return typeof value === "string" ? value : null
}
