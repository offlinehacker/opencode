import type { Data, Item } from "./state.js"
import { signed } from "./sign.js"

export type Claim = {
  relay_url: string
  channel_id: string
  channel_secret: string
}

export type Pub = {
  accepted: boolean
  suppressed?: boolean
  reason?: string
  device_count?: number
  deliveries?: Array<{ delivery_id?: string; device_id?: string; sent?: boolean; error?: string | null }>
}

type Check = {
  ok?: boolean
  accepted?: boolean
}

export async function claim(
  url: string,
  pair: string,
  server: string,
  version: string,
  existing?: { channel_id: string; channel_secret: string },
) {
  return call<Claim>(url, "/v1/pair/claim", {
    pair_token: pair,
    plugin_version: version,
    server_label: server,
    ...(existing ?? {}),
  })
}

export async function checkin(data: Data) {
  const relay = data.relay
  if (!relay) throw new Error("relay not configured")
  return call<Check>(
    relay.url,
    "/v1/channel/checkin",
    signed(relay.secret, {
      v: 1,
      channel_id: relay.channel,
      checked_at: Date.now(),
    }),
  )
}

export async function publish(data: Data, item: Item) {
  const relay = data.relay
  if (!relay) throw new Error("relay not configured")
  return call<Pub>(
    relay.url,
    "/v1/events/publish",
    signed(relay.secret, {
      v: item.v,
      channel_id: relay.channel,
      event_id: item.event_id,
      kind: item.kind,
      session_id: item.session_id,
      request_id: item.request_id,
      occurred_at: item.occurred_at,
      collapse_id: item.collapse_id,
    }),
  )
}

export type Device = {
  device_id: string
  device_name: string | null
  apns_env: string
  prefs: Record<string, boolean>
  error_code: string | null
  active: boolean
  created_at: number | null
}

export async function devices(data: Data) {
  const relay = data.relay
  if (!relay) throw new Error("relay not configured")
  const res = await call<{ devices: Device[] }>(relay.url, "/v1/channel/devices", {
    channel_id: relay.channel,
    channel_secret: relay.secret,
  })
  return res.devices
}

export async function removeDevice(data: Data, deviceId: string) {
  const relay = data.relay
  if (!relay) throw new Error("relay not configured")
  return call<{ ok: boolean }>(relay.url, "/v1/channel/device/remove", {
    channel_id: relay.channel,
    channel_secret: relay.secret,
    device_id: deviceId,
  })
}

export const RELAY_TIMEOUT_MS = 15_000

async function call<T>(root: string, path: string, body: Record<string, unknown>) {
  const url = new URL(path, slash(root))
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as T & { error?: string; message?: string }) : ({} as T)
  if (res.ok) return data
  throw new Error(
    (data as { error?: string; message?: string }).error ??
      (data as { message?: string }).message ??
      (text || `relay request failed: ${res.status}`),
  )
}

function slash(url: string) {
  return url.endsWith("/") ? url : `${url}/`
}
