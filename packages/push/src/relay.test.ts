import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { claim, checkin, publish } from "./relay"
import type { Data } from "./state"

const seen: Array<{ path: string; body: Record<string, unknown> }> = []

const data = (): Data => ({
  v: 1,
  mode: "relay",
  root: {},
  cool: {},
  relay: {
    url: "",
    channel: "ch_1",
    secret: "sec_1",
  },
})

let url = ""
let srv: ReturnType<typeof Bun.serve> | undefined

beforeAll(() => {
  let port = 0
  srv = Bun.serve({
    port: 0,
    fetch: async (req: Request): Promise<Response> => {
      const body = (await req.json()) as Record<string, unknown>
      seen.push({ path: new URL(req.url).pathname, body })
      switch (new URL(req.url).pathname) {
        case "/v1/pair/claim":
          return Response.json({
            relay_url: url,
            channel_id: "ch_1",
            channel_secret: "sec_1",
          })
        case "/v1/channel/checkin":
          return Response.json({ ok: true })
        case "/v1/events/publish":
          return Response.json({ accepted: true, delivery_id: "dlv_1" })
        default:
          return new Response("not found", { status: 404 })
      }
    },
  })
  const next = srv.port
  if (!next) throw new Error("missing test port")
  port = next
  url = `http://127.0.0.1:${port}`
})

afterAll(async () => {
  await srv?.stop()
})

describe("push relay", () => {
  test("claims a pair token", async () => {
    const res = await claim(url, "ptok_1", "macbook", "0.1.0")
    expect(res.channel_id).toBe("ch_1")
    expect(seen.at(-1)?.path).toBe("/v1/pair/claim")
  })

  test("signs checkins", async () => {
    const next = data()
    next.relay!.url = url
    await checkin(next)
    const body = seen.at(-1)?.body
    expect(body?.channel_id).toBe("ch_1")
    expect(typeof body?.sig).toBe("string")
  })

  test("signs publish payloads", async () => {
    const next = data()
    next.relay!.url = url
    const res = await publish(next, {
      v: 1,
      event_id: "evt_1",
      kind: "complete",
      session_id: "ses_1",
      request_id: null,
      occurred_at: 1,
      collapse_id: "complete:ses_1",
    })
    expect(res.delivery_id).toBe("dlv_1")
    const body = seen.at(-1)?.body
    expect(body?.event_id).toBe("evt_1")
    expect(typeof body?.sig).toBe("string")
  })
})
