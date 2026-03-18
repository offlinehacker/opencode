import { describe, expect, test } from "bun:test"
import { EventEmitter } from "node:events"
import { constants, type ClientHttp2Session, type ClientHttp2Stream, type OutgoingHttpHeaders } from "node:http2"
import { createAdapter, payload, testkey } from "./apns"

describe("push apns", () => {
  test("builds generic payload text", () => {
    expect(payload({ delivery: "dlv_1", token: "tok", kind: "approval", channel: "ch_1", session: "ses_1" })).toEqual({
      aps: {
        alert: { title: "OpenCode", body: "Session needs attention" },
        sound: "default",
        badge: 1,
        "interruption-level": "active",
      },
      v: 1,
    })
  })

  test("makes test payload text unique", () => {
    expect(payload({ delivery: "dlv_abcdef", token: "tok", kind: "test", channel: "ch_1" }).aps.alert).toEqual({
      title: "OpenCode",
      body: "Test notification abcdef",
    })
  })

  test("returns disabled when unconfigured", async () => {
    const apns = createAdapter({ mode: "live" })
    const res = await apns.send({ delivery: "dlv_1", token: "tok", kind: "test", channel: "ch_1" })
    expect(res.sent).toBe(false)
    expect(res.code).toBe("apns_unconfigured")
  })

  test("sends live requests with jwt auth", async () => {
    const seen: Array<{
      url: string
      path: string | null
      auth: string | null
      topic: string | null
      collapse: string | null
      body: string
    }> = []
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      env: "sandbox",
      dial: stub(({ url, headers, body }) => {
        seen.push({
          url,
          path: str(headers[constants.HTTP2_HEADER_PATH]),
          auth: str(headers.authorization),
          topic: str(headers["apns-topic"]),
          collapse: str(headers["apns-collapse-id"]),
          body,
        })
        return { status: 200 }
      }),
      now: () => 1_700_000_000_000,
    })

    const res = await apns.send({
      delivery: "dlv_1",
      token: "tok_live",
      kind: "complete",
      channel: "ch_1",
      session: "ses_1",
      collapse: "complete:ses_1",
    })
    expect(res.sent).toBe(true)
    expect(res.mode).toBe("live")
    expect(seen[0]?.url).toBe("https://api.sandbox.push.apple.com")
    expect(seen[0]?.path).toBe("/3/device/tok_live")
    expect(seen[0]?.topic).toBe("dev.whispercode.app")
    expect(seen[0]?.auth?.startsWith("bearer ")).toBe(true)
    expect(seen[0]?.collapse).toBeNull()
    expect(JSON.parse(seen[0]!.body)).toEqual({
      aps: {
        alert: { title: "OpenCode", body: "Session needs attention" },
        sound: "default",
        badge: 1,
        "interruption-level": "active",
      },
      v: 1,
    })
    apns.close()
  })

  test("does not send apns-collapse-id", async () => {
    const seen: Array<Record<string, string | null>> = []
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      env: "sandbox",
      dial: stub(({ headers }) => {
        seen.push({ collapse: str(headers["apns-collapse-id"]) })
        return { status: 200 }
      }),
    })

    await apns.send({
      delivery: "dlv_1",
      token: "tok_live",
      kind: "complete",
      channel: "ch_1",
      collapse: "complete:ses_1",
    })
    expect(seen[0]?.collapse).toBeNull()
    apns.close()
  })

  test("returns apns_timeout when server hangs", async () => {
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: hangStub(),
      timeout: 50,
    })

    const res = await apns.send({ delivery: "dlv_1", token: "tok_hang", kind: "complete", channel: "ch_1" })
    expect(res).toEqual({ sent: false, mode: "live", code: "apns_timeout" })
    apns.close()
  })

  test("marks invalid apns tokens", async () => {
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(() => ({ status: 400, body: { reason: "BadDeviceToken" } })),
    })

    const res = await apns.send({ delivery: "dlv_1", token: "tok_bad", kind: "complete", channel: "ch_1" })
    expect(res.sent).toBe(false)
    expect(res.code).toBe("BadDeviceToken")
    expect(res.invalid).toBe(true)
    apns.close()
  })

  test("reuses http2 session across sends", async () => {
    let dialCount = 0
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      env: "sandbox",
      dial: (origin: string | URL) => {
        dialCount++
        return stub(() => ({ status: 200 }))(origin)
      },
    })

    await apns.send({ delivery: "dlv_1", token: "tok_1", kind: "test", channel: "ch_1" })
    await apns.send({ delivery: "dlv_2", token: "tok_2", kind: "test", channel: "ch_1" })
    await apns.send({ delivery: "dlv_3", token: "tok_3", kind: "test", channel: "ch_1" })
    expect(dialCount).toBe(1)
    apns.close()
  })

  test("session error between requests nulls pool and reconnects", async () => {
    let dialCount = 0
    let currentSession: EventEmitter | undefined
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      env: "sandbox",
      dial: (origin: string | URL) => {
        dialCount++
        const ses = stub(() => ({ status: 200 }))(origin)
        currentSession = ses
        return ses
      },
    })

    await apns.send({ delivery: "dlv_1", token: "tok_1", kind: "test", channel: "ch_1" })
    expect(dialCount).toBe(1)

    // Simulate a GOAWAY / TCP drop between requests
    currentSession!.emit("error", new Error("GOAWAY"))

    await apns.send({ delivery: "dlv_2", token: "tok_2", kind: "test", channel: "ch_1" })
    expect(dialCount).toBe(2)
    apns.close()
  })

  test("error listener count does not grow with requests", async () => {
    let currentSession: EventEmitter | undefined
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      env: "sandbox",
      dial: (origin: string | URL) => {
        const ses = stub(() => ({ status: 200 }))(origin)
        currentSession = ses
        return ses
      },
    })

    await apns.send({ delivery: "dlv_1", token: "tok_1", kind: "test", channel: "ch_1" })
    const countAfterFirst = currentSession!.listenerCount("error")

    await apns.send({ delivery: "dlv_2", token: "tok_2", kind: "test", channel: "ch_1" })
    await apns.send({ delivery: "dlv_3", token: "tok_3", kind: "test", channel: "ch_1" })
    await apns.send({ delivery: "dlv_4", token: "tok_4", kind: "test", channel: "ch_1" })

    expect(currentSession!.listenerCount("error")).toBe(countAfterFirst)
    apns.close()
  })

  test("reconnects when session is destroyed", async () => {
    let dialCount = 0
    let currentSession: any
    const apns = createAdapter({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      env: "sandbox",
      dial: (origin: string | URL) => {
        dialCount++
        const ses = stub(() => ({ status: 200 }))(origin)
        currentSession = ses
        return ses
      },
    })

    await apns.send({ delivery: "dlv_1", token: "tok_1", kind: "test", channel: "ch_1" })
    expect(dialCount).toBe(1)

    currentSession.destroyed = true

    await apns.send({ delivery: "dlv_2", token: "tok_2", kind: "test", channel: "ch_1" })
    expect(dialCount).toBe(2)
    apns.close()
  })
})

function stub(
  fn: (input: { url: string; headers: OutgoingHttpHeaders; body: string }) => { status: number; body?: unknown },
) {
  return (input: string | URL) => {
    const url = String(input)
    const ses = new EventEmitter() as ClientHttp2Session & EventEmitter
    ;(ses as any).destroyed = false
    ;(ses as any).closed = false
    ses.close = () => {
      ;(ses as any).closed = true
      return ses
    }
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
          const res = fn({ url, headers, body })
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

function hangStub() {
  return (input: string | URL) => {
    const ses = new EventEmitter() as ClientHttp2Session & EventEmitter
    ses.close = () => ses
    ses.request = (_headers: OutgoingHttpHeaders) => {
      const req = new EventEmitter() as ClientHttp2Stream & EventEmitter
      req.setEncoding = () => req
      req.close = () => {}
      req.end = ((_chunk?: unknown, _enc?: unknown, _cb?: unknown) => {
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
