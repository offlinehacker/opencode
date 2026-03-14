import fs from "fs"
import { createPrivateKey, generateKeyPairSync, sign as signData, type KeyObject } from "crypto"
import {
  connect,
  constants,
  type ClientHttp2Session,
  type IncomingHttpHeaders,
  type OutgoingHttpHeaders,
} from "node:http2"

export type PushMsg = {
  delivery: string
  token: string
  kind: string
  channel: string
  session?: string | null
  collapse?: string | null
}

export type PushRes = {
  sent: boolean
  mode: "mock" | "disabled" | "live"
  code?: string
  invalid?: boolean
}

export type PushAdapter = {
  send(msg: PushMsg): Promise<PushRes>
}

type Mode = "mock" | "disabled" | "live"

export type Dial = (input: string | URL) => ClientHttp2Session

type Opts = {
  mode?: Mode
  team?: string
  kid?: string
  topic?: string
  key?: string
  keyfile?: string
  env?: "sandbox" | "production"
  dial?: Dial
  now?: () => number
}

type Live = {
  team: string
  kid: string
  topic: string
  key: KeyObject
  root: string
  dial: Dial
  now: () => number
}

export function createAdapter(opts?: Opts) {
  const mode = opts?.mode ?? envMode(opts)
  const live = mode === "live" ? cfg(opts) : undefined
  const auth = live ? token(live) : undefined

  return {
    async send(msg: PushMsg) {
      void payload(msg)
      if (mode === "mock") {
        return {
          sent: true,
          mode,
        }
      }
      if (!live || !auth) {
        return {
          sent: false,
          mode: "disabled",
          code: mode === "live" ? "apns_unconfigured" : "apns_disabled",
        }
      }

      return send(live, auth, msg)
    },
  } satisfies PushAdapter
}

export function payload(msg: PushMsg) {
  return {
    aps: {
      alert: text(msg),
      sound: "default",
      badge: 1,
      "interruption-level": "active",
    },
    v: 1,
  }
}

export function testkey() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" })
  return pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString()
}

function text(msg: PushMsg) {
  switch (msg.kind) {
    case "complete":
    case "error":
    case "approval":
    case "question":
      return { title: "OpenCode", body: "Session needs attention" }
    case "test":
      return { title: "OpenCode", body: `Test notification ${msg.delivery.slice(-6)}` }
    default:
      return { title: "OpenCode", body: "Session needs attention" }
  }
}

function envMode(opts?: Opts): Mode {
  const mode = opts?.mode ?? process.env.WHISPERCODE_PUSH_APNS_MODE
  if (mode === "mock" || mode === "disabled" || mode === "live") return mode
  return ready(opts) ? "live" : "disabled"
}

function ready(opts?: Opts) {
  return !!team(opts) && !!kid(opts) && !!topic(opts) && !!pem(opts)
}

function cfg(opts?: Opts): Live | undefined {
  const teamID = team(opts)
  const keyID = kid(opts)
  const nextTopic = topic(opts)
  const nextKey = key(opts)
  if (!teamID || !keyID || !nextTopic || !nextKey) return
  return {
    team: teamID,
    kid: keyID,
    topic: nextTopic,
    root: root(kind(opts)),
    dial: opts?.dial ?? connect,
    now: opts?.now ?? Date.now,
    key: nextKey,
  }
}

function team(opts?: Opts) {
  return opts?.team ?? process.env.WHISPERCODE_PUSH_APNS_TEAM_ID
}

function kid(opts?: Opts) {
  return opts?.kid ?? process.env.WHISPERCODE_PUSH_APNS_KEY_ID
}

function topic(opts?: Opts) {
  return opts?.topic ?? process.env.WHISPERCODE_PUSH_APNS_TOPIC
}

function kind(opts?: Opts): "sandbox" | "production" {
  const value = opts?.env ?? process.env.WHISPERCODE_PUSH_APNS_ENV
  if (value === "production") return value
  return "sandbox"
}

function pem(opts?: Opts) {
  if (opts?.key) return opts.key
  if (opts?.keyfile) return fs.readFileSync(opts.keyfile, "utf8")
  if (process.env.WHISPERCODE_PUSH_APNS_KEY) return process.env.WHISPERCODE_PUSH_APNS_KEY
  if (process.env.WHISPERCODE_PUSH_APNS_KEY_FILE) {
    return fs.readFileSync(process.env.WHISPERCODE_PUSH_APNS_KEY_FILE, "utf8")
  }
}

function key(opts?: Opts) {
  const value = pem(opts)
  if (!value) return
  return createPrivateKey(value)
}

function token(cfg: Live) {
  let cached = ""
  let exp = 0

  return () => {
    const now = Math.floor(cfg.now() / 1000)
    if (cached && now < exp - 60) return cached

    const head = enc({ alg: "ES256", kid: cfg.kid, typ: "JWT" })
    const body = enc({ iss: cfg.team, iat: now })
    const input = `${head}.${body}`
    const sig = signData("sha256", Buffer.from(input), { key: cfg.key, dsaEncoding: "ieee-p1363" }).toString(
      "base64url",
    )
    cached = `${input}.${sig}`
    exp = now + 50 * 60
    return cached
  }
}

async function send(cfg: Live, auth: () => string, msg: PushMsg): Promise<PushRes> {
  const url = new URL(`/3/device/${encodeURIComponent(msg.token)}`, cfg.root)
  const res = await post(cfg, url, auth(), payload(msg))
  if (res.status >= 200 && res.status < 300) {
    return {
      sent: true,
      mode: "live",
    }
  }

  const code = res.reason ?? `http_${res.status}`
  return {
    sent: false,
    mode: "live",
    code,
    invalid: invalid(res.status, code),
  }
}

async function post(cfg: Live, url: URL, auth: string, body: Record<string, unknown>) {
  return await new Promise<{ status: number; reason?: string }>((resolve, reject) => {
    const ses = cfg.dial(url.origin)
    const head: OutgoingHttpHeaders = {
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `${url.pathname}${url.search}`,
      authorization: `bearer ${auth}`,
      "apns-topic": cfg.topic,
      "apns-push-type": "alert",
      "apns-priority": "10",
      "content-type": "application/json",
    }

    let code = 0
    let text = ""
    let done = false

    const stop = (err?: unknown) => {
      if (done) return
      done = true
      ses.close()
      if (err) reject(err)
    }

    const req = ses.request(head)
    ses.once("error", (err) => stop(err))
    req.setEncoding("utf8")
    req.on("response", (next: IncomingHttpHeaders) => {
      code = Number(next[constants.HTTP2_HEADER_STATUS] ?? 0)
    })
    req.on("data", (chunk: string) => {
      text += chunk
    })
    req.once("error", (err) => stop(err))
    req.once("end", () => {
      if (done) return
      done = true
      ses.close()
      resolve({ status: code, reason: reason(text) })
    })
    req.end(JSON.stringify(body))
  })
}

function reason(text: string) {
  if (!text) return
  try {
    const body = JSON.parse(text) as { reason?: unknown }
    return typeof body.reason === "string" ? body.reason : undefined
  } catch {
    return
  }
}

function invalid(status: number, code: string) {
  if (status === 410) return true
  return code === "BadDeviceToken" || code === "DeviceTokenNotForTopic" || code === "Unregistered"
}

function root(env: "sandbox" | "production") {
  if (env === "production") return "https://api.push.apple.com"
  return "https://api.sandbox.push.apple.com"
}

function enc(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString("base64url")
}
