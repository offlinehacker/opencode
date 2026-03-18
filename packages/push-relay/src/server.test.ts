import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { EventEmitter } from "node:events"
import { constants, type ClientHttp2Session, type ClientHttp2Stream, type OutgoingHttpHeaders } from "node:http2"
import { testkey } from "./apns"
import { sign } from "./sign"
import { createRelay, listen } from "./server"
import { Store } from "./store"

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
        device_name: "iPhone",
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

      const testRes = await post(env.root, "/v1/device/test", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
      })
      expect(testRes.accepted).toBe(true)
      expect(testRes.sent).toBe(true)
      expect(testRes.mode).toBe("mock")
      expect(typeof testRes.delivery_id).toBe("string")
      expect(testRes.collapse_id).toBe("test:device")

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

  test("reactivates device after putToken with fresh token", async () => {
    let callCount = 0
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(({ headers }) => {
        callCount++
        if (callCount === 1) {
          return { status: 400, body: { reason: "BadDeviceToken" } }
        }
        return { status: 200 }
      }),
    })
    try {
      const start = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_old",
        device_name: "iPhone",
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
      expect(active.status).toBe("active")

      const body1 = publish(claim.channel_id, "evt_fail")
      const res1 = await post(env.root, "/v1/events/publish", {
        ...body1,
        sig: sign(claim.channel_secret, body1),
      })
      expect(res1.accepted).toBe(true)
      expect(res1.device_count).toBe(1)
      const d1 = (res1.deliveries as Record<string, unknown>[])[0]!
      expect(d1.sent).toBe(false)
      expect(d1.error).toBe("BadDeviceToken")

      const failed = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(failed.status).toBe("failed")

      await put(env.root, "/v1/device/token", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
        apns_token: "tok_fresh",
      })

      await post(env.root, "/v1/channel/checkin", {
        ...check(claim.channel_id),
        sig: sign(claim.channel_secret, check(claim.channel_id)),
      })

      const reactivated = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(reactivated.status).toBe("active")

      const body2 = publish(claim.channel_id, "evt_ok")
      const res2 = await post(env.root, "/v1/events/publish", {
        ...body2,
        sig: sign(claim.channel_secret, body2),
      })
      expect(res2.accepted).toBe(true)
      expect(res2.device_count).toBe(1)
      const d2 = (res2.deliveries as Record<string, unknown>[])[0]!
      expect(d2.sent).toBe(true)
    } finally {
      await env.stop()
    }
  })

  test("sandbox device routes to api.sandbox.push.apple.com", async () => {
    const origins: string[] = []
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(({ origin }) => {
        origins.push(origin)
        return { status: 200 }
      }),
    })
    try {
      const start = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_sandbox",
        device_name: "iPhone",
        app_version: "1.0.0",
        apns_env: "sandbox",
      })
      const claim = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: start.pair_token,
        plugin_version: "0.1.0",
        server_label: "Dev MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim.channel_id),
        sig: sign(claim.channel_secret, check(claim.channel_id)),
      })
      const active = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(active.status).toBe("active")

      const res = await post(env.root, "/v1/device/test", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
      })
      expect(res.sent).toBe(true)
      expect(origins.length).toBeGreaterThan(0)
      expect(origins[0]).toBe("https://api.sandbox.push.apple.com")
    } finally {
      await env.stop()
    }
  })

  test("production device routes to api.push.apple.com", async () => {
    const origins: string[] = []
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(({ origin }) => {
        origins.push(origin)
        return { status: 200 }
      }),
    })
    try {
      const start = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_prod",
        device_name: "iPhone",
        app_version: "1.0.0",
        apns_env: "production",
      })
      const claim = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: start.pair_token,
        plugin_version: "0.1.0",
        server_label: "Prod MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim.channel_id),
        sig: sign(claim.channel_secret, check(claim.channel_id)),
      })
      const active = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(active.status).toBe("active")

      const res = await post(env.root, "/v1/device/test", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
      })
      expect(res.sent).toBe(true)
      expect(origins.length).toBeGreaterThan(0)
      expect(origins[0]).toBe("https://api.push.apple.com")
    } finally {
      await env.stop()
    }
  })

  test("device with no apns_env defaults to production", async () => {
    const origins: string[] = []
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(({ origin }) => {
        origins.push(origin)
        return { status: 200 }
      }),
    })
    try {
      const start = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_legacy",
        device_name: "iPhone",
        app_version: "1.0.0",
      })
      const claim = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: start.pair_token,
        plugin_version: "0.1.0",
        server_label: "Legacy MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim.channel_id),
        sig: sign(claim.channel_secret, check(claim.channel_id)),
      })
      const active = await get(env.root, `/v1/pair/${start.pair_id}`)
      expect(active.status).toBe("active")

      const res = await post(env.root, "/v1/device/test", {
        channel_id: claim.channel_id,
        device_id: String(active.device_id),
        device_secret: String(active.device_secret),
      })
      expect(res.sent).toBe(true)
      expect(origins.length).toBeGreaterThan(0)
      expect(origins[0]).toBe("https://api.push.apple.com")
    } finally {
      await env.stop()
    }
  })

  test("multi-device pairing and fan-out publish", async () => {
    let sendCount = 0
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(() => {
        sendCount++
        return { status: 200 }
      }),
    })
    try {
      // Pair device A (iPhone)
      const startA = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_iphone",
        device_name: "iPhone",
        app_version: "1.0.0",
        apns_env: "production",
      })
      const claim1 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startA.pair_token,
        plugin_version: "0.1.0",
        server_label: "Alice MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim1.channel_id),
        sig: sign(claim1.channel_secret, check(claim1.channel_id)),
      })
      const activeA = await get(env.root, `/v1/pair/${startA.pair_id}`)
      expect(activeA.status).toBe("active")

      // Pair device B (iPad) with same channel credentials
      const startB = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_ipad",
        device_name: "iPad",
        app_version: "1.0.0",
        apns_env: "production",
      })
      const claim2 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startB.pair_token,
        plugin_version: "0.1.0",
        server_label: "Alice MacBook",
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })
      expect(claim2.channel_id).toBe(claim1.channel_id)
      expect(claim2.channel_secret).toBe(claim1.channel_secret)

      // Publish → both devices receive push
      sendCount = 0
      const body1 = publish(claim1.channel_id, "evt_multi_1")
      const res1 = await post(env.root, "/v1/events/publish", {
        ...body1,
        sig: sign(claim1.channel_secret, body1),
      })
      expect(res1.accepted).toBe(true)
      expect(res1.device_count).toBe(2)
      expect((res1.deliveries as unknown[]).length).toBe(2)
      expect(sendCount).toBe(2)

      // Revoke device A via channel-auth removal
      await post(env.root, "/v1/channel/device/remove", {
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
        device_id: String(activeA.device_id),
      })

      // Publish again → only device B
      sendCount = 0
      const body2 = publish(claim1.channel_id, "evt_multi_2")
      const res2 = await post(env.root, "/v1/events/publish", {
        ...body2,
        sig: sign(claim1.channel_secret, body2),
      })
      expect(res2.accepted).toBe(true)
      expect(res2.device_count).toBe(1)
      expect((res2.deliveries as unknown[]).length).toBe(1)
      expect(sendCount).toBe(1)
    } finally {
      await env.stop()
    }
  })

  test("lists devices for a channel", async () => {
    const env = await setup()
    try {
      const startA = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_a",
        device_name: "iPhone",
        app_version: "1.0.0",
      })
      const claim1 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startA.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim1.channel_id),
        sig: sign(claim1.channel_secret, check(claim1.channel_id)),
      })

      const startB = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_b",
        device_name: "iPad",
        app_version: "1.0.0",
      })
      await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startB.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })

      const devicesRes = await post(env.root, "/v1/channel/devices", {
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })
      const list = devicesRes.devices as Array<Record<string, unknown>>
      expect(list.length).toBe(2)
      const names = list.map((d) => d.device_name).sort()
      expect(names).toEqual(["iPad", "iPhone"])
      expect(list.every((d) => d.active === true)).toBe(true)
    } finally {
      await env.stop()
    }
  })

  test("removes a device via channel auth", async () => {
    const env = await setup()
    try {
      const startA = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_a",
        device_name: "iPhone",
        app_version: "1.0.0",
      })
      const claim1 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startA.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim1.channel_id),
        sig: sign(claim1.channel_secret, check(claim1.channel_id)),
      })
      const activeA = await get(env.root, `/v1/pair/${startA.pair_id}`)

      const startB = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_b",
        device_name: "iPad",
        app_version: "1.0.0",
      })
      await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startB.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })

      // Remove device A
      const rmRes = await post(env.root, "/v1/channel/device/remove", {
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
        device_id: String(activeA.device_id),
      })
      expect(rmRes.ok).toBe(true)

      // List devices — A should be inactive, B still active
      const devicesRes = await post(env.root, "/v1/channel/devices", {
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })
      const list = devicesRes.devices as Array<Record<string, unknown>>
      expect(list.length).toBe(2)
      const deviceA = list.find((d) => d.device_name === "iPhone")
      const deviceB = list.find((d) => d.device_name === "iPad")
      expect(deviceA?.active).toBe(false)
      expect(deviceB?.active).toBe(true)
    } finally {
      await env.stop()
    }
  })

  test("mixed-preferences fan-out: only sends to opted-in devices", async () => {
    let sendCount = 0
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(() => {
        sendCount++
        return { status: 200 }
      }),
    })
    try {
      // Pair device A
      const startA = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_a_mix",
        device_name: "iPhone",
        app_version: "1.0.0",
        apns_env: "production",
      })
      const claim1 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startA.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim1.channel_id),
        sig: sign(claim1.channel_secret, check(claim1.channel_id)),
      })
      const activeA = await get(env.root, `/v1/pair/${startA.pair_id}`)
      expect(activeA.status).toBe("active")

      // Pair device B on the same channel
      const startB = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_b_mix",
        device_name: "iPad",
        app_version: "1.0.0",
        apns_env: "production",
      })
      await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startB.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })

      // Set device A to opt out of "complete" events
      await put(env.root, "/v1/device/preferences", {
        channel_id: claim1.channel_id,
        device_id: String(activeA.device_id),
        device_secret: String(activeA.device_secret),
        prefs: { complete: false, approval: true, question: true, error: true },
      })

      // Publish a "complete" event → only device B should receive it
      sendCount = 0
      const body = publish(claim1.channel_id, "evt_mixed_prefs")
      const res = await post(env.root, "/v1/events/publish", {
        ...body,
        sig: sign(claim1.channel_secret, body),
      })
      expect(res.accepted).toBe(true)
      expect(res.device_count).toBe(1)
      expect(sendCount).toBe(1)
    } finally {
      await env.stop()
    }
  })

  test("replay dedup after multi-device publish", async () => {
    const env = await setup({
      mode: "live",
      team: "TEAM123",
      kid: "KEY123",
      topic: "dev.whispercode.app",
      key: testkey(),
      dial: stub(() => ({ status: 200 })),
    })
    try {
      // Pair device A
      const startA = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_a_dup",
        device_name: "iPhone",
        app_version: "1.0.0",
        apns_env: "production",
      })
      const claim1 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startA.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim1.channel_id),
        sig: sign(claim1.channel_secret, check(claim1.channel_id)),
      })

      // Pair device B on same channel
      const startB = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_b_dup",
        device_name: "iPad",
        app_version: "1.0.0",
        apns_env: "production",
      })
      await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startB.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
        channel_id: claim1.channel_id,
        channel_secret: claim1.channel_secret,
      })

      // Publish once — 2 devices
      const body = publish(claim1.channel_id, "evt_dedup")
      const res1 = await post(env.root, "/v1/events/publish", {
        ...body,
        sig: sign(claim1.channel_secret, body),
      })
      expect(res1.accepted).toBe(true)
      expect(res1.device_count).toBe(2)

      // Re-publish same event_id → should be suppressed as replay
      const res2 = await post(env.root, "/v1/events/publish", {
        ...body,
        sig: sign(claim1.channel_secret, body),
      })
      expect(res2.suppressed).toBe(true)
      expect(res2.reason).toBe("replay")
    } finally {
      await env.stop()
    }
  })

  test("claim reuse with wrong channel secret returns 401", async () => {
    const env = await setup()
    try {
      // Pair device A and get a channel
      const startA = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_a_sec",
        device_name: "iPhone",
        app_version: "1.0.0",
      })
      const claim1 = await post<Claim>(env.root, "/v1/pair/claim", {
        pair_token: startA.pair_token,
        plugin_version: "0.1.0",
        server_label: "MacBook",
      })
      await post(env.root, "/v1/channel/checkin", {
        ...check(claim1.channel_id),
        sig: sign(claim1.channel_secret, check(claim1.channel_id)),
      })

      // Start a new pair request for device B
      const startB = await post<Start>(env.root, "/v1/pair/start", {
        apns_token: "tok_b_sec",
        device_name: "iPad",
        app_version: "1.0.0",
      })

      // Try to claim with correct channel_id but wrong secret
      const res = await fetch(new URL("/v1/pair/claim", env.root), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pair_token: startB.pair_token,
          plugin_version: "0.1.0",
          server_label: "MacBook",
          channel_id: claim1.channel_id,
          channel_secret: "wrong_secret",
        }),
      })
      expect(res.status).toBe(401)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.error).toBe("bad_channel_secret")
    } finally {
      await env.stop()
    }
  })

  test("rejects request body larger than 64 KB", async () => {
    const env = await setup()
    try {
      const big = JSON.stringify({ apns_token: "x".repeat(65_536), device_name: "d", app_version: "1" })
      const res = await fetch(new URL("/v1/pair/start", env.root), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: big,
      })
      expect(res.status).toBe(413)
    } finally {
      await env.stop()
    }
  })

  test("json() content-length guard rejects oversized body", async () => {
    const { createRelay } = await import("./server")
    const next = await tmp()
    const relay = createRelay({ file: next.file, mode: "mock" })
    try {
      const req = new Request("http://localhost/v1/pair/start", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": "100000" },
        body: JSON.stringify({ apns_token: "t", device_name: "d", app_version: "1" }),
      })
      const res = await relay.fetch(req)
      expect(res.status).toBe(413)
      const data = (await res.json()) as Record<string, unknown>
      expect(data.error).toBe("body_too_large")
    } finally {
      relay.stop()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("cleanup removes old deliveries and terminal pair requests", async () => {
    const next = await tmp()
    const db = new Store({ file: next.file, pairMs: 1 })
    try {
      // Seed a channel + device
      const now = Date.now()
      db.db.exec(`INSERT INTO channel (id, secret, server_label, created_at) VALUES ('ch1', 'sec', 'srv', ${now})`)
      db.db.exec(
        `INSERT INTO device (id, channel_id, secret, apns_token, prefs_json, created_at)
         VALUES ('dev1', 'ch1', 'dsec', 'tok', '{}', ${now})`,
      )

      // Insert old deliveries and pair requests
      const old = now - 100_000
      db.db.exec(
        `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, collapse_id, status, created_at)
         VALUES ('dlv1', 'ch1', 'dev1', 'e1', 'complete', 'c:1', 'sent', ${old})`,
      )
      db.db.exec(
        `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, collapse_id, status, created_at)
         VALUES ('dlv2', 'ch1', 'dev1', 'e2', 'complete', 'c:2', 'sent', ${old})`,
      )
      db.db.exec(
        `INSERT INTO pair_request (id, token_hash, apns_token, device_name, app_version, status, expires_at, created_at)
         VALUES ('p1', 'h1', 'tok', 'dev', '1.0', 'expired', ${old}, ${old})`,
      )
      db.db.exec(
        `INSERT INTO pair_request (id, token_hash, apns_token, device_name, app_version, status, expires_at, created_at)
         VALUES ('p2', 'h2', 'tok', 'dev', '1.0', 'failed', ${old}, ${old})`,
      )
      // This one should NOT be deleted (active status)
      db.db.exec(
        `INSERT INTO pair_request (id, token_hash, apns_token, device_name, app_version, status, expires_at, created_at)
         VALUES ('p3', 'h3', 'tok', 'dev', '1.0', 'active', ${old}, ${old})`,
      )

      const result = db.cleanup({
        deliveryMaxAge: 0,
        pairMaxAge: 0,
      })
      expect(result.deliveries).toBe(2)
      expect(result.pairs).toBe(2)
      expect(result.devices).toBe(0)
      expect(result.channels).toBe(0)

      // Verify the active pair request was kept
      const remaining = db.db.prepare(`SELECT COUNT(*) as c FROM pair_request`).get() as { c: number }
      expect(remaining.c).toBe(1)
    } finally {
      db.close()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("cleanup respects FK constraints", async () => {
    const next = await tmp()
    const db = new Store({ file: next.file, pairMs: 1 })
    try {
      const now = Date.now()
      const old = now - 100_000

      // Create channel + device (both revoked long ago)
      db.db.exec(
        `INSERT INTO channel (id, secret, server_label, created_at, revoked_at) VALUES ('ch1', 'sec', 'srv', ${old}, ${old})`,
      )
      db.db.exec(
        `INSERT INTO device (id, channel_id, secret, apns_token, prefs_json, created_at, revoked_at)
         VALUES ('dev1', 'ch1', 'dsec', 'tok', '{}', ${old}, ${old})`,
      )
      db.db.exec(`INSERT INTO channel_checkin (channel_id, last_seen_at) VALUES ('ch1', ${old})`)

      // Add a delivery referencing the device — prevents device deletion
      db.db.exec(
        `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, collapse_id, status, created_at)
         VALUES ('dlv1', 'ch1', 'dev1', 'e1', 'complete', 'c:1', 'sent', ${old})`,
      )

      // Cleanup with delivery retention (deliveries are recent, won't be deleted)
      const r1 = db.cleanup({
        deliveryMaxAge: 200_000,
        deviceMaxAge: 0,
        channelMaxAge: 0,
      })
      // Device should NOT be deleted because delivery still references it
      expect(r1.devices).toBe(0)
      // Channel should NOT be deleted because delivery still references it
      expect(r1.channels).toBe(0)
      expect(r1.checkins).toBe(0)

      // Now clean deliveries too
      const r2 = db.cleanup({
        deliveryMaxAge: 0,
        deviceMaxAge: 0,
        channelMaxAge: 0,
      })
      expect(r2.deliveries).toBe(1)
      expect(r2.devices).toBe(1)
      expect(r2.checkins).toBe(1)
      expect(r2.channels).toBe(1)
    } finally {
      db.close()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("rate limiter returns 429 when limit exceeded", async () => {
    const next = await tmp()
    const relay = createRelay({
      file: next.file,
      mode: "mock",
      rateLimit: {
        tiers: {
          strict: { limit: 3, windowMs: 60_000 },
          standard: { limit: 10, windowMs: 60_000 },
          generous: { limit: 20, windowMs: 60_000 },
        },
        routes: [
          { method: "GET", pattern: "/health", tier: "exempt" },
          { method: "POST", pattern: "/v1/pair/start", tier: "strict" },
          { method: "POST", pattern: "/v1/events/publish", tier: "generous" },
        ],
      },
      ipExtractor: () => "1.2.3.4",
    })
    try {
      // 3 requests should succeed
      for (let i = 0; i < 3; i++) {
        const req = new Request("http://localhost/v1/pair/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apns_token: `tok_${i}`, device_name: "d", app_version: "1" }),
        })
        const res = await relay.fetch(req)
        expect(res.status).toBe(200)
      }

      // 4th request should be rate limited
      const req = new Request("http://localhost/v1/pair/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ apns_token: "tok_x", device_name: "d", app_version: "1" }),
      })
      const res = await relay.fetch(req)
      expect(res.status).toBe(429)
      expect(res.headers.get("retry-after")).toBeTruthy()
      const body = (await res.json()) as Record<string, unknown>
      expect(body.error).toBe("rate_limited")
      expect(typeof body.retry_after).toBe("number")
    } finally {
      relay.stop()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("rate limiter exempts health endpoint", async () => {
    const next = await tmp()
    const relay = createRelay({
      file: next.file,
      mode: "mock",
      rateLimit: {
        tiers: {
          strict: { limit: 1, windowMs: 60_000 },
          standard: { limit: 1, windowMs: 60_000 },
          generous: { limit: 1, windowMs: 60_000 },
        },
        routes: [
          { method: "GET", pattern: "/health", tier: "exempt" },
          { method: "POST", pattern: "/v1/pair/start", tier: "strict" },
        ],
      },
      ipExtractor: () => "1.2.3.4",
    })
    try {
      // Health should always work, even with limit=1 on other tiers
      for (let i = 0; i < 10; i++) {
        const req = new Request("http://localhost/health")
        const res = await relay.fetch(req)
        expect(res.status).toBe(200)
      }
    } finally {
      relay.stop()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    }
  })

  test("rate limiter enforces different tiers independently", async () => {
    const next = await tmp()
    const relay = createRelay({
      file: next.file,
      mode: "mock",
      rateLimit: {
        tiers: {
          strict: { limit: 2, windowMs: 60_000 },
          standard: { limit: 5, windowMs: 60_000 },
          generous: { limit: 10, windowMs: 60_000 },
        },
        routes: [
          { method: "GET", pattern: "/health", tier: "exempt" },
          { method: "POST", pattern: "/v1/pair/start", tier: "strict" },
          { method: "GET", pattern: "/v1/pair/:id", tier: "standard" },
        ],
      },
      ipExtractor: () => "1.2.3.4",
    })
    try {
      // Exhaust strict tier (2 requests)
      for (let i = 0; i < 2; i++) {
        const req = new Request("http://localhost/v1/pair/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apns_token: `tok_${i}`, device_name: "d", app_version: "1" }),
        })
        const res = await relay.fetch(req)
        expect(res.status).toBe(200)
      }

      // Strict tier should be blocked
      const blocked = await relay.fetch(
        new Request("http://localhost/v1/pair/start", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ apns_token: "tok_x", device_name: "d", app_version: "1" }),
        }),
      )
      expect(blocked.status).toBe(429)

      // Standard tier should still work (GET /v1/pair/:id)
      const standard = await relay.fetch(new Request("http://localhost/v1/pair/some-id"))
      // 404 because pair doesn't exist, but NOT 429
      expect(standard.status).not.toBe(429)
    } finally {
      relay.stop()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
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
        device_name: "iPhone",
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
      expect(res.accepted).toBe(true)
      expect(res.device_count).toBe(1)
      const d0 = (res.deliveries as Record<string, unknown>[])[0]!
      expect(d0.sent).toBe(false)
      expect(d0.error).toBe("BadDeviceToken")
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
  const srv = listen({ file: next.file, mode: "mock", port: 0, rateLimit: false, ...opts })
  return {
    root: `http://127.0.0.1:${srv.port}`,
    stop: async () => {
      await srv.stop()
      await fs.rm(next.dir, { recursive: true, force: true }).catch(() => undefined)
    },
  }
}

function stub(
  fn: (input: { origin: string; headers: OutgoingHttpHeaders; body: string }) => { status: number; body?: unknown },
) {
  return (origin: string | URL) => {
    const originStr = typeof origin === "string" ? origin : origin.toString()
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
          const res = fn({ origin: originStr, headers, body })
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
