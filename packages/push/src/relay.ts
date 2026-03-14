import type { Data, Item } from "./state"
import { signed } from "./sign"

export type Claim = {
  relay_url: string
  channel_id: string
  channel_secret: string
}

export type Pub = {
  accepted: boolean
  suppressed?: boolean
  reason?: string
  delivery_id?: string
}

type Check = {
  ok?: boolean
  accepted?: boolean
}

export async function claim(url: string, pair: string, server: string, version: string) {
  return call<Claim>(url, "/v1/pair/claim", {
    pair_token: pair,
    plugin_version: version,
    server_label: server,
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

async function call<T>(root: string, path: string, body: Record<string, unknown>) {
  const url = new URL(path, slash(root))
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
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
