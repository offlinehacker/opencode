import type { PairInfo, Platform, PushState } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { addPush, hasPushSpec, pairPush, PushPlugin } from "@/utils/push-plugin"
import { serverAuthHeaders } from "@/utils/server"

const PTY_TIMEOUT = 60_000
const CLAIM_WAIT = 5_000
const CLAIM_POLL = 1_000
const CLAIM_GAP = 1_000
const FETCH_MS = 10_000
const FINISH_GAP = 5_000
const FINISH_SETTLE = 1_500
const OUT_LIMIT = 2_000
const WAIT_MS = 15_000
const WAIT_GAP = 500

type PathRes = {
  state?: string
  directory?: string
}

type Cfg = {
  plugin?: string[]
}

type Runner = {
  name: "npx" | "bunx"
  command: string
  args: string[]
}

type PairRes = {
  status?: "pending" | "claimed" | "active" | "expired" | "failed"
  message?: string
  channel_id?: string
  device_id?: string
  device_secret?: string
}

type Read = {
  at: number
  res?: PairRes
  err?: Error
  job?: Promise<PairRes>
}

type Stream = {
  close: () => void
  done: Promise<{
    out: string
    opened: boolean
    error?: Error
  }>
}

type PairSeed = Partial<PairInfo>
type WaitPair = {
  pair?: PairInfo
  limited: boolean
}
type WaitRelay = {
  pair?: PairRes
  limited: boolean
}

type Pull = Pick<
  Platform,
  "beginPushPairing" | "getPushPairing" | "getPushState" | "pushState" | "requestPushPermission" | "setPushCredentials"
>

export type PushPhase = "permission" | "register" | "begin" | "claim" | "finish"

export type PushIssueCode =
  | "permission_denied"
  | "permission_required"
  | "unsupported"
  | "apns_register_failed"
  | "apns_register_timeout"
  | "missing_token"
  | "relay_invalid"
  | "relay_rate_limited"
  | "relay_unreachable"
  | "pair_token_missing"
  | "host_install_failed"
  | "pair_claim_timeout"
  | "pair_expired"
  | "pair_failed"
  | "repair_needed"
  | "server_required"
  | "unknown"

export type PushIssue = {
  code: PushIssueCode
  message: string
  detail?: string
  action: "retry" | "settings" | "none"
}

export type PushSetupInput = {
  platform: Pull & Pick<Platform, "fetch">
  server?: ServerConnection.Any
  relay?: string
  pair?: PairSeed
  ask?: boolean
  onPair?: (value: PairInfo) => void
  onPhase?: (value?: PushPhase) => void
  onTrace?: (value: string) => void
}

export type PushSetupResult = {
  ok: true
  pair: PairInfo
  push?: PushState
}

export class PushFail extends Error {
  issue: PushIssue

  constructor(issue: PushIssue) {
    super(issue.message)
    this.name = "PushFail"
    this.issue = issue
  }
}

function pair(token: string, relay?: string) {
  const args = ["pair", "--pair", token, "--json"]
  if (relay) args.push("--relay", relay)
  return args
}

function npx(token: string, prefix?: string, relay?: string): Runner | undefined {
  if (!prefix) return
  return {
    name: "npx",
    command: "npx",
    args: ["--yes", "--prefix", prefix, "--package", PushPlugin.spec, PushPlugin.bin, ...pair(token, relay)],
  }
}

function bunx(token: string, relay?: string): Runner | undefined {
  if (PushPlugin.local(PushPlugin.spec)) return
  return {
    name: "bunx",
    command: "bunx",
    args: [PushPlugin.spec, ...pair(token, relay)],
  }
}

function pairCmd(token?: string, relay?: string, command?: string) {
  if (!token) return command
  return pairPush(token, relay)
}

function act(code: PushIssueCode): PushIssue["action"] {
  switch (code) {
    case "permission_denied":
      return "settings"
    case "unsupported":
    case "server_required":
      return "none"
    default:
      return "retry"
  }
}

function issue(code: PushIssueCode, message: string, detail?: string): PushIssue {
  return {
    code,
    message,
    detail,
    action: act(code),
  }
}

function fail(code: PushIssueCode, message: string, detail?: string): PushFail {
  return new PushFail(issue(code, message, detail))
}

function text(value: unknown) {
  return value instanceof Error ? value.message : String(value)
}

function limited(value: unknown) {
  const next = text(value).trim().toLowerCase()
  return (
    next.includes("rate_limited") ||
    next.includes("rate limited") ||
    next.includes("too many requests") ||
    next.includes("429")
  )
}

function limitMessage(value?: string) {
  if (value && !limited(value)) return value
  return "Push relay is temporarily rate limited. Wait a minute and try again."
}

function timeout(ms: number) {
  const abort = new AbortController()
  let hit = false
  const id = setTimeout(() => {
    hit = true
    abort.abort()
  }, ms)
  return {
    signal: abort.signal,
    hit: () => hit,
    clear: () => clearTimeout(id),
  }
}

function wait(ms: number) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms))
}

function mark(value: boolean | undefined) {
  if (value === true) return "1"
  if (value === false) return "0"
  return "-"
}

function brief(value?: string) {
  if (!value) return "-"
  if (value.length <= 24) return value
  return `${value.slice(0, 12)}...${value.slice(-8)}`
}

const reads = new Map<string, Read>()

function slot(relay: string, pairId: string) {
  return `${relay} ${pairId}`
}

function drop(relay?: string, pairId?: string) {
  if (!relay || !pairId) return
  reads.delete(slot(relay, pairId))
}

function hold(item: Read, gap: number) {
  if (item.err) return gap
  const state = item.res?.status
  if (state === "pending" || state === "claimed") {
    return Math.min(gap, CLAIM_GAP)
  }
  return gap
}

function note(input: Pick<PushSetupInput, "onTrace"> | undefined, value: string) {
  input?.onTrace?.(`${new Date().toISOString()} ${value}`)
}

function listText(list?: string[]) {
  if (!list?.length) return "-"
  return list.join(",")
}

function pushText(push?: PushState) {
  return [
    `perm=${push?.permission ?? "-"}`,
    `allowed=${mark(push?.allowed)}`,
    `registered=${mark(push?.registered)}`,
    `paired=${mark(push?.paired)}`,
    `code=${push?.diag?.lastCode ?? "-"}`,
    `err=${push?.diag?.lastError ?? "-"}`,
  ].join(" ")
}

function pairText(value?: {
  id?: string
  status?: string
  expires?: string
  channel?: string
  device?: string
  message?: string
}) {
  return [
    `status=${value?.status ?? "-"}`,
    `id=${brief(value?.id)}`,
    `expires=${value?.expires ?? "-"}`,
    `channel=${brief(value?.channel)}`,
    `device=${brief(value?.device)}`,
    `msg=${value?.message ?? "-"}`,
  ].join(" ")
}

function terminal(status?: string) {
  return status === "active" || status === "expired" || status === "failed"
}

function expired(value?: string) {
  if (!value) return false
  const time = Date.parse(value)
  if (Number.isNaN(time)) return false
  return time <= Date.now()
}

function reuse(pair?: PairSeed, relay?: string): PairInfo | undefined {
  if (!pair?.id || !pair.token) return
  if (expired(pair.expires)) return
  if (pair.status === "active" || pair.status === "expired") return
  return {
    id: pair.id,
    status: pair.status ?? "pending",
    token: pair.token,
    command: pairCmd(pair.token, relay, pair.command),
    expires: pair.expires,
    channel: pair.channel,
    device: pair.device,
    message: pair.message,
  }
}

function clip(out: string) {
  const text = out.trim()
  if (!text) return ""
  if (text.length <= OUT_LIMIT) return text
  return text.slice(-OUT_LIMIT)
}

function failRun(runner: Runner["name"], out: string) {
  const text = clip(out)
  if (!text) return `Push pairing command failed via ${runner}.`
  return `Push pairing command failed via ${runner}: ${text}`
}

function okRun(out: string) {
  const text = clip(out).toLowerCase()
  if (!text) return false
  const ok = text.includes('"ok": true') || text.includes("ok: true")
  const cmd =
    text.includes('"cmd": "pair"') ||
    text.includes("cmd: pair") ||
    text.includes('"cmd": "install"') ||
    text.includes("cmd: install")
  return ok && cmd
}

export function pushIssue(push?: PushState): PushIssue | undefined {
  if (push?.permission === "unsupported") {
    return issue("unsupported", "Notifications are unavailable on this device.")
  }
  if (push?.permission === "denied") {
    return issue("permission_denied", "Turn on notifications for WhisperCode in the iPhone Settings app.")
  }

  switch (push?.diag?.lastCode) {
    case "apns_register_failed":
      return issue("apns_register_failed", "Apple push registration failed. Try again in a moment.")
    case "missing_token":
      return issue("missing_token", "WhisperCode could not get an Apple push token yet. Try again in a moment.")
    case "bad_relay":
      return issue("relay_invalid", "The push relay URL is invalid.")
    case "relay_rate_limited":
      return issue("relay_rate_limited", limitMessage(push.diag.lastError))
    case "relay_timeout":
      return issue(
        "relay_unreachable",
        push.diag.lastError ?? "The push relay timed out. Check that the relay is reachable and try again.",
      )
    case "bad_reply":
    case "bad_pair":
    case "decode":
    case "relay_error":
      if (limited(push.diag.lastError)) {
        return issue("relay_rate_limited", limitMessage(push.diag.lastError))
      }
      return issue("pair_failed", push.diag.lastError ?? "The push relay returned an unexpected response.")
    case "repair_needed":
    case "device_not_found":
    case "bad_device_secret":
      return issue("repair_needed", "This iPhone needs to re-pair with the OpenCode host.")
  }
}

export function mergePushIssue(saved?: PushIssue, push?: PushState): PushIssue | undefined {
  const native = pushIssue(push)
  if (native) return native
  if (!saved) return
  if (push?.paired) return

  switch (saved.code) {
    case "permission_denied":
      if (push && push.permission !== "denied") return
      break
    case "permission_required":
      if (push?.allowed) return
      break
    case "apns_register_failed":
    case "apns_register_timeout":
    case "missing_token":
      if (push?.registered) return
      break
  }

  return saved
}

function errIssue(err: unknown, push?: PushState, phase?: PushPhase): PushIssue {
  if (err instanceof PushFail) return err.issue

  const message = text(err).trim()
  const lower = message.toLowerCase()

  if (lower.includes("turn on notifications for whispercode")) {
    return issue("permission_denied", message)
  }
  if (lower.includes("enable notifications for whispercode")) {
    return issue(push?.permission === "denied" ? "permission_denied" : "permission_required", message)
  }
  if (lower.includes("apns registration failed")) {
    return issue("apns_register_failed", message)
  }
  if (lower.includes("still waiting for apple push registration")) {
    return issue("apns_register_timeout", message)
  }
  if (lower.includes("apns token unavailable")) {
    return issue("missing_token", "WhisperCode could not get an Apple push token yet. Try again in a moment.")
  }
  if (lower.includes("apple push token")) {
    return issue("missing_token", message)
  }
  if (lower.includes("connect to an opencode server first")) {
    return issue("server_required", message)
  }
  if (lower.includes("push relay url is invalid")) {
    return issue("relay_invalid", message)
  }
  if (limited(message)) {
    return issue("relay_rate_limited", limitMessage(message))
  }
  if (lower.includes("timed out") && lower.includes("relay")) {
    return issue("relay_unreachable", message)
  }
  if (lower.includes("push pairing relay check")) {
    return issue("pair_failed", message)
  }
  if (lower.includes("push pairing token unavailable")) {
    return issue("pair_token_missing", message)
  }
  if (lower.includes("never observed the claim") || lower.includes("has not finished syncing yet")) {
    return issue("pair_claim_timeout", message)
  }
  if (lower.includes("pairing request expired")) {
    return issue("pair_expired", message)
  }
  if (lower.includes("could not finish pairing") || lower.includes("pairing failed")) {
    return issue("pair_failed", message)
  }
  if (
    lower.includes("failed via") ||
    lower.includes("notification plugin failed to install") ||
    lower.includes("push pair failed")
  ) {
    return issue("host_install_failed", message)
  }
  if (lower.includes("re-pair this iphone")) {
    return issue("repair_needed", message)
  }

  const next = pushIssue(push)
  if (next) return next

  if (phase === "register") {
    return issue("apns_register_timeout", message || "WhisperCode is still waiting for Apple push registration.")
  }

  return issue("unknown", message || "Notification setup failed. Try again.")
}

async function pull(input: Pull) {
  const next = await input.getPushState?.().catch(() => undefined)
  return next ?? input.pushState?.()
}

async function pullPair(input: PushSetupInput) {
  return input.platform.getPushPairing?.().catch((err) => {
    if (limited(err)) throw err
    return undefined
  })
}

async function waitPush(input: PushSetupInput) {
  const end = Date.now() + WAIT_MS
  let last = ""
  for (;;) {
    const push = await pull(input.platform)
    const line = pushText(push)
    if (line !== last) {
      last = line
      note(input, `waitPush ${line}`)
    }
    const issue = pushIssue(push)
    if (issue?.code === "apns_register_failed" || issue?.code === "missing_token") {
      throw new PushFail(issue)
    }
    if (push?.permission === "denied") {
      throw fail("permission_denied", "Turn on notifications for WhisperCode in the iPhone Settings app.")
    }
    if (push?.allowed && push.registered) return push
    if (Date.now() >= end) {
      if (!push?.allowed) {
        throw fail("permission_required", "Enable notifications for WhisperCode to finish setup.")
      }
      if (issue) {
        throw new PushFail(issue)
      }
      throw fail("apns_register_timeout", "WhisperCode is still waiting for Apple push registration.")
    }
    await wait(WAIT_GAP)
  }
}

async function waitDone(input: PushSetupInput): Promise<WaitPair> {
  const end = Date.now() + WAIT_MS
  let last: PairInfo | undefined
  let seen = ""
  for (;;) {
    let halt = false
    const next = await pullPair(input).catch((err) => {
      if (!limited(err)) throw err
      halt = true
      note(input, `waitDone limited err=${text(err)}`)
      return last
    })
    if (next) {
      last = next
      const line = pairText(next)
      if (line !== seen) {
        seen = line
        note(input, `waitDone ${line}`)
      }
      input.onPair?.(next)
      if (terminal(next.status)) {
        return { pair: next, limited: false }
      }
    }
    if (halt) {
      return { pair: last, limited: true }
    }
    if (Date.now() >= end) {
      return { pair: last, limited: false }
    }
    await wait(FINISH_GAP)
  }
}

async function waitRelayDone(input: PushSetupInput, pairId?: string): Promise<WaitRelay> {
  const relay = input.relay
  if (!relay || !pairId) return { pair: undefined, limited: false }
  const fetch = input.platform.fetch ?? globalThis.fetch
  const end = Date.now() + WAIT_MS
  let last: PairRes | undefined
  let seen = ""
  while (Date.now() < end) {
    let halt = false
    const next = await readPair(fetch, relay, pairId, FINISH_GAP).catch((err) => {
      if (limited(err)) {
        halt = true
        note(input, `waitRelayDone limited err=${text(err)}`)
        return last
      }
      return undefined
    })
    if (next) {
      last = next
      const line = pairText({
        id: pairId,
        status: next.status,
        channel: next.channel_id,
        device: next.device_id,
        message: next.message,
      })
      if (line !== seen) {
        seen = line
        note(input, `waitRelayDone ${line}`)
      }
      if (terminal(next.status)) {
        return { pair: next, limited: false }
      }
    }
    if (halt) {
      return { pair: last, limited: true }
    }
    await wait(FINISH_GAP)
  }
  return { pair: last, limited: false }
}

async function pullRelay(input: PushSetupInput, pairId?: string): Promise<WaitRelay> {
  const relay = input.relay
  if (!relay || !pairId) return { pair: undefined, limited: false }
  const fetch = input.platform.fetch ?? globalThis.fetch
  const next = await readPair(fetch, relay, pairId, FINISH_GAP).catch((err) => {
    if (!limited(err)) throw err
    note(input, `pullRelay limited err=${text(err)}`)
    return undefined
  })
  if (next) {
    note(
      input,
      `pullRelay ${pairText({
        id: pairId,
        status: next.status,
        channel: next.channel_id,
        device: next.device_id,
        message: next.message,
      })}`,
    )
  }
  return {
    pair: next,
    limited: !next,
  }
}

async function syncPair(input: PushSetupInput, pair?: PairRes) {
  if (pair?.status !== "active") return
  if (!pair.channel_id || !pair.device_id || !pair.device_secret) return
  note(
    input,
    `syncPair channel=${brief(pair.channel_id)} device=${brief(pair.device_id)} secret=${mark(!!pair.device_secret)}`,
  )
  const push = await input.platform.setPushCredentials?.({
    channel: pair.channel_id,
    device: pair.device_id,
    secret: pair.device_secret,
  })
  note(input, `syncPair done ${pushText(push)}`)
  return {
    push,
    pair: {
      id: input.pair?.id ?? "active",
      status: "active" as const,
      channel: pair.channel_id,
      device: pair.device_id,
    },
  }
}

export async function fetchWithTimeout(
  fetch: typeof globalThis.fetch,
  input: RequestInfo | URL,
  init: RequestInit,
  label: string,
  ms = FETCH_MS,
) {
  const timer = timeout(ms)
  try {
    return await fetch(input, { ...init, signal: timer.signal })
  } catch (err) {
    if (timer.hit()) {
      throw new Error(`${label} timed out. Check that the server is reachable and try again.`)
    }
    throw err
  } finally {
    timer.clear()
  }
}

async function runPty(
  fetch: typeof globalThis.fetch,
  conn: ServerConnection.Any,
  command: string,
  args: string[],
  cwd?: string,
) {
  const res = await fetchWithTimeout(
    fetch,
    new URL("/pty", conn.http.url),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serverAuthHeaders(conn.http),
      },
      body: JSON.stringify({ command, args, cwd }),
    },
    "Push pairing command",
  )

  if (!res.ok) {
    throw new Error(`push pair failed: ${res.status}`)
  }

  const pty = (await res.json()) as { id: string }
  return pty.id
}

function watchPty(conn: ServerConnection.Any, id: string, input?: Pick<PushSetupInput, "onTrace">): Stream {
  const Socket = globalThis.WebSocket
  if (!Socket) {
    return {
      close: () => undefined,
      done: Promise.resolve({
        out: "",
        opened: false,
        error: new Error("Push pairing command stream is unavailable on this device."),
      }),
    }
  }

  let socket: WebSocket | undefined
  let settled = false

  const done = new Promise<{ out: string; opened: boolean; error?: Error }>((resolve) => {
    let opened = false
    let out = ""
    let failed: Error | undefined
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timer !== undefined) {
        globalThis.clearTimeout(timer)
      }
      socket?.removeEventListener("open", onOpen)
      socket?.removeEventListener("message", onMessage)
      socket?.removeEventListener("error", onError)
      socket?.removeEventListener("close", onClose)
      resolve({
        out,
        opened,
        error:
          error ??
          failed ??
          (!opened ? new Error("Push pairing command stream closed before it could connect.") : undefined),
      })
    }

    const onOpen = () => {
      opened = true
      note(input, `claim stream open pty=${brief(id)}`)
      if (timer !== undefined) {
        globalThis.clearTimeout(timer)
        timer = undefined
      }
    }
    const onMessage = (event: MessageEvent) => {
      if (typeof event.data === "string") {
        out += event.data
        return
      }
      if (!(event.data instanceof ArrayBuffer)) return
      const bytes = new Uint8Array(event.data)
      if (bytes[0] !== 0) return
    }
    const onError = () => {
      note(input, `claim stream err pty=${brief(id)}`)
      failed = new Error("Push pairing command stream failed. Check that the host is reachable and try again.")
    }
    const onClose = () => {
      note(input, `claim stream close pty=${brief(id)} opened=${mark(opened)}`)
      finish()
    }

    try {
      const url = new URL(`/pty/${id}/connect`, conn.http.url)
      url.searchParams.set("cursor", "0")
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
      url.username = conn.http.username ?? ""
      url.password = conn.http.password ?? ""

      socket = new Socket(url.toString())
      socket.binaryType = "arraybuffer"
      socket.addEventListener("open", onOpen)
      socket.addEventListener("message", onMessage)
      socket.addEventListener("error", onError)
      socket.addEventListener("close", onClose)
      timer = globalThis.setTimeout(() => {
        finish(new Error("Push pairing command stream timed out. Check that the host is reachable and try again."))
        try {
          socket?.close(1000)
        } catch {}
      }, FETCH_MS)
    } catch (err) {
      finish(new Error(`Push pairing command stream could not connect: ${text(err)}`))
    }
  })

  return {
    close: () => {
      if (settled) return
      try {
        socket?.close(1000)
      } catch {}
    },
    done,
  }
}

async function readPair(
  fetch: typeof globalThis.fetch,
  relay: string,
  pairId: string,
  gap = CLAIM_GAP,
): Promise<PairRes> {
  const id = slot(relay, pairId)
  const now = Date.now()
  const prev = reads.get(id)
  if (prev?.job) {
    return prev.job
  }
  if (prev && now - prev.at < hold(prev, gap)) {
    if (prev.err) throw prev.err
    if (prev.res) return prev.res
  }

  const next: Read = prev ?? { at: 0 }
  const job = (async () => {
    try {
      const res = await fetchWithTimeout(
        fetch,
        new URL(`/v1/pair/${encodeURIComponent(pairId)}`, relay),
        { cache: "no-store" },
        "Push pairing relay check",
      )
      if (!res.ok) {
        throw new Error(`Push pairing relay check failed: ${res.status}`)
      }
      const data = (await res.json()) as PairRes
      next.at = Date.now()
      next.res = data
      next.err = undefined
      return data
    } catch (err) {
      const fail = err instanceof Error ? err : new Error(text(err))
      next.at = Date.now()
      next.err = fail
      next.res = undefined
      throw fail
    } finally {
      next.job = undefined
      reads.set(id, next)
    }
  })()

  next.job = job
  reads.set(id, next)
  return job
}

async function readPath(fetch: typeof globalThis.fetch, conn: ServerConnection.Any) {
  const res = await fetchWithTimeout(
    fetch,
    new URL("/path", conn.http.url),
    {
      headers: serverAuthHeaders(conn.http),
    },
    "Push pairing path check",
  )
  if (!res.ok) return
  return (await res.json()) as PathRes
}

async function readCfg(fetch: typeof globalThis.fetch, conn: ServerConnection.Any) {
  const res = await fetchWithTimeout(
    fetch,
    new URL("/global/config", conn.http.url),
    {
      headers: serverAuthHeaders(conn.http),
      cache: "no-store",
    },
    "Push pairing host config check",
  )
  if (!res.ok) {
    throw new Error(`Push pairing host config check failed: ${res.status}`)
  }
  return (await res.json()) as Cfg
}

async function patchCfg(fetch: typeof globalThis.fetch, conn: ServerConnection.Any, cfg: Cfg) {
  const res = await fetchWithTimeout(
    fetch,
    new URL("/global/config", conn.http.url),
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...serverAuthHeaders(conn.http),
      },
      body: JSON.stringify(cfg),
    },
    "Push pairing host config update",
  )
  if (!res.ok) {
    throw new Error(`Push pairing host config update failed: ${res.status}`)
  }
  return (await res.json()) as Cfg
}

async function postDispose(fetch: typeof globalThis.fetch, conn: ServerConnection.Any) {
  const res = await fetchWithTimeout(
    fetch,
    new URL("/global/dispose", conn.http.url),
    {
      method: "POST",
      headers: serverAuthHeaders(conn.http),
    },
    "Push pairing host recycle",
  )
  if (!res.ok) {
    throw new Error(`Push pairing host recycle failed: ${res.status}`)
  }
}

async function waitHost(
  fetch: typeof globalThis.fetch,
  conn: ServerConnection.Any,
  input?: Pick<PushSetupInput, "onTrace">,
) {
  const end = Date.now() + WAIT_MS
  let err: unknown

  while (Date.now() < end) {
    try {
      const path = await readPath(fetch, conn)
      if (path) {
        note(input, `waitHost ok state=${brief(path.state)} dir=${brief(path.directory)}`)
        return
      }
    } catch (cause) {
      err = cause
    }
    await wait(WAIT_GAP)
  }

  throw err ?? new Error("Push plugin host refresh timed out. Check that the host is reachable and try again.")
}

async function recycleHost(
  fetch: typeof globalThis.fetch,
  conn: ServerConnection.Any,
  input?: Pick<PushSetupInput, "onTrace">,
) {
  let err: unknown

  note(input, "recycleHost start")
  await postDispose(fetch, conn).catch((cause) => {
    err = cause
  })

  try {
    await waitHost(fetch, conn, input)
    note(input, "recycleHost ok")
  } catch (cause) {
    throw err ?? cause
  }
}

async function ensureHost(input: {
  platform: Pick<Platform, "fetch">
  server: ServerConnection.Any
  onTrace?: (value: string) => void
}) {
  const fetch = input.platform.fetch ?? globalThis.fetch
  const conn = input.server

  try {
    const cfg = await readCfg(fetch, conn)
    note(input, `ensureHost cfg=${listText(cfg?.plugin)}`)
    if (!hasPushSpec(cfg?.plugin)) {
      const next = addPush(cfg?.plugin)
      note(input, `ensureHost patch=${listText(next)}`)
      await patchCfg(fetch, conn, {
        plugin: next,
      })
    }

    await recycleHost(fetch, conn, input)
  } catch (err) {
    note(input, `ensureHost err=${text(err)}`)
    throw fail("host_install_failed", `Could not activate the OpenCode notification plugin on the host: ${text(err)}`)
  }
}

async function waitClaim(
  fetch: typeof globalThis.fetch,
  relay: string,
  pairId: string,
  ms = CLAIM_WAIT,
  input?: Pick<PushSetupInput, "onTrace">,
): Promise<PairRes | undefined> {
  const deadline = Date.now() + ms
  let last: PairRes | undefined
  let err: unknown
  let seen = ""
  while (Date.now() < deadline) {
    try {
      last = await readPair(fetch, relay, pairId, CLAIM_GAP)
      err = undefined
    } catch (cause) {
      if (limited(cause)) throw cause
      err = cause
    }
    const line = pairText({
      id: pairId,
      status: last?.status,
      channel: last?.channel_id,
      device: last?.device_id,
      message: last?.message,
    })
    if (line !== seen) {
      seen = line
      note(input, `waitClaim ${line}`)
    }
    if (!last?.status || last.status === "pending") {
      await wait(CLAIM_POLL)
      continue
    }
    return last
  }
  if (err && (!last?.status || last.status === "pending")) {
    throw err
  }
  return last
}

export async function claimPush(input: {
  platform: Pick<Platform, "fetch">
  server?: ServerConnection.Any
  token: string
  relay?: string
  pairId?: string
  onTrace?: (value: string) => void
}) {
  const conn = input.server
  if (!conn) {
    throw fail("server_required", "Connect to an OpenCode server first.")
  }

  const fetch = input.platform.fetch ?? globalThis.fetch
  const relay = input.relay
  const pairId = input.pairId
  const path = await readPath(fetch, conn).catch(() => undefined)
  const prefix = path?.state
  const cwd = prefix || path?.directory
  const runs = [bunx(input.token, relay), npx(input.token, prefix, relay)].filter((item) => !!item)
  note(
    input,
    `claim start relay=${relay ?? "-"} pair=${brief(pairId)} cwd=${brief(cwd)} prefix=${brief(prefix)} runs=${runs.map((item) => item.name).join(",")}`,
  )
  drop(relay, pairId)
  let last: PushFail | undefined

  for (const runner of runs) {
    drop(relay, pairId)
    note(input, `claim runner=${runner.name}`)
    let id: string
    try {
      id = await runPty(fetch, conn, runner.command, runner.args, cwd)
      note(input, `claim pty=${brief(id)}`)
    } catch (err) {
      note(input, `claim pty err=${text(err)}`)
      throw fail("host_install_failed", text(err))
    }

    const stream = watchPty(conn, id, input)

    if (!relay || !pairId) {
      const result = await stream.done
      if (result.error && !result.opened) {
        throw fail("host_install_failed", result.error.message)
      }
      return { ok: true }
    }

    let done:
      | {
          out: string
          opened: boolean
          error?: Error
        }
      | undefined
    let pairSeen: PairRes | undefined

    void stream.done
      .then((value) => {
        done = value
        return value
      })
      .catch((err) => {
        done = {
          out: "",
          opened: false,
          error: err instanceof Error ? err : new Error(text(err)),
        }
      })

    const deadline = Date.now() + PTY_TIMEOUT
    let seen = ""
    for (;;) {
      if (Date.now() >= deadline) {
        stream.close()
        throw fail(
          "host_install_failed",
          "Push pairing command timed out. Check that the host is reachable and try again.",
        )
      }
      const pair = await readPair(fetch, relay, pairId, CLAIM_GAP).catch((err) => {
        if (limited(err)) throw err
        return undefined
      })
      const line = pairText({
        id: pairId,
        status: pair?.status,
        channel: pair?.channel_id,
        device: pair?.device_id,
        message: pair?.message,
      })
      if (line !== seen) {
        seen = line
        note(input, `claim poll ${line}`)
      }
      if (pair?.status === "active" || pair?.status === "claimed") {
        pairSeen = pair
      }
      if (pair?.status === "failed") {
        stream.close()
        throw fail("pair_failed", pair.message || "The relay reported that push pairing failed.")
      }
      if (pair?.status === "expired") {
        stream.close()
        throw fail("pair_expired", "This pairing request expired before the host finished pairing this iPhone.")
      }
      if (done) break
      await Promise.race([stream.done, wait(CLAIM_POLL)])
    }

    const result = done ?? (await stream.done)
    const out = clip(result.out)
    const good = okRun(out)
    note(
      input,
      `claim result runner=${runner.name} opened=${mark(result.opened)} good=${mark(good)} err=${result.error ? result.error.message : "-"} out=${out || "-"}`,
    )
    const pair =
      pairSeen?.status === "active"
        ? pairSeen
        : await waitClaim(
            fetch,
            relay,
            pairId,
            pairSeen?.status === "claimed" || good || result.error ? WAIT_MS : out ? CLAIM_POLL : CLAIM_WAIT,
            input,
          )
    if (pair?.status === "active" || pair?.status === "claimed") {
      note(
        input,
        `claim ok runner=${runner.name} ${pairText({ id: pairId, status: pair.status, message: pair.message })}`,
      )
      return { ok: true, pair }
    }
    if (pair?.status === "expired") {
      throw fail("pair_expired", "This pairing request expired before the host finished pairing this iPhone.")
    }
    if (pair?.status === "failed") {
      throw fail("pair_failed", pair.message || "The relay reported that push pairing failed.")
    }
    if (good) {
      last = fail(
        "pair_claim_timeout",
        `Push pairing command finished via ${runner.name}, but the relay never observed the claim.`,
        out || undefined,
      )
      note(input, `claim timeout runner=${runner.name}`)
      break
    }
    if (out) {
      last = fail("host_install_failed", failRun(runner.name, result.out), clip(result.out) || undefined)
      note(input, `claim fail runner=${runner.name} out`)
      continue
    }
    if (result.error) {
      last = fail("host_install_failed", result.error.message)
      note(input, `claim fail runner=${runner.name} err=${result.error.message}`)
      continue
    }
    last = fail(
      "pair_claim_timeout",
      `Push pairing command ended via ${runner.name}, but the relay never observed the claim.`,
    )
    note(input, `claim miss runner=${runner.name}`)
  }

  if (last) throw last
  note(input, "claim fail no_runner")
  throw fail(
    "host_install_failed",
    `The OpenCode host could not finish pairing this iPhone. Run ${pairPush(input.token, relay)} or ${pairPush(input.token, relay, "bunx")} on the host and try again.`,
  )
}

export async function runPushSetup(input: PushSetupInput): Promise<PushSetupResult> {
  const platform = input.platform
  if (!platform.beginPushPairing || !platform.getPushPairing || !platform.getPushState) {
    throw fail("unsupported", "Push pairing is unavailable on this device.")
  }

  let push = await pull(platform)
  let phase: PushPhase | undefined
  note(input, `start ${pushText(push)}`)

  try {
    if (push?.permission === "unsupported") {
      throw fail("unsupported", "Notifications are unavailable on this device.")
    }

    if (!push?.allowed) {
      if (push?.permission === "denied") {
        throw fail("permission_denied", "Turn on notifications for WhisperCode in the iPhone Settings app.")
      }
      if (!input.ask || !platform.requestPushPermission) {
        throw fail("permission_required", "Enable notifications for WhisperCode to finish setup.")
      }
      phase = "permission"
      input.onPhase?.(phase)
      note(input, "phase permission")
      push = await platform.requestPushPermission()
      note(input, `permission ${pushText(push)}`)
      if (!push.allowed) {
        throw fail(
          push.permission === "denied" ? "permission_denied" : "permission_required",
          push.permission === "denied"
            ? "Turn on notifications for WhisperCode in the iPhone Settings app."
            : "Enable notifications for WhisperCode to finish setup.",
        )
      }
    }

    if (!push.registered) {
      phase = "register"
      input.onPhase?.(phase)
      note(input, "phase register")
      push = await waitPush(input)
      note(input, `register ${pushText(push)}`)
    }

    if (!input.server) {
      throw fail("server_required", "Connect to an OpenCode server first.")
    }

    let pair = reuse(input.pair, input.relay)
    if (pair) {
      note(input, `reuse ${pairText(pair)}`)
    }
    if (!pair) {
      phase = "begin"
      input.onPhase?.(phase)
      note(input, "phase begin")
      pair = await platform.beginPushPairing()
      pair = { ...pair, command: pairCmd(pair.token, input.relay, pair.command) }
      note(input, `begin ${pairText(pair)}`)
      input.onPair?.(pair)
    }

    if (!pair.token) {
      note(input, "pair token missing, polling native pair")
      const next = await pullPair(input)
      if (next) {
        pair = { ...next, command: pairCmd(next.token, input.relay, next.command) }
        note(input, `pair poll ${pairText(pair)}`)
        input.onPair?.(pair)
      }
    }

    if (!pair.token) {
      throw fail("pair_token_missing", "Push pairing token unavailable.")
    }

    phase = "claim"
    input.onPhase?.(phase)
    note(input, "phase claim")
    await ensureHost({
      platform,
      server: input.server,
      onTrace: input.onTrace,
    })

    const claim = await claimPush({
      platform,
      server: input.server,
      token: pair.token,
      relay: input.relay,
      pairId: pair.id,
      onTrace: input.onTrace,
    })
    note(input, "claim done")

    phase = "finish"
    input.onPhase?.(phase)
    note(input, "phase finish")
    let limitedHit = false
    let done: PairInfo | undefined =
      claim.pair?.status === "active"
        ? {
            id: pair.id,
            status: "active" as const,
            channel: claim.pair.channel_id,
            device: claim.pair.device_id,
            message: claim.pair.message,
          }
        : undefined
    let relayDone = claim.pair
    note(input, `finish seed ${pairText({ id: pair.id, status: relayDone?.status, message: relayDone?.message })}`)
    let synced = await syncPair(input, relayDone)
    if (!done) {
      note(input, `finish settle ms=${FINISH_SETTLE}`)
      await wait(FINISH_SETTLE)
    }
    if (!done) {
      note(input, "finish pull start")
      done = await pullPair(input).catch((err) => {
        if (!limited(err)) throw err
        limitedHit = true
        note(input, `finish pull limited err=${text(err)}`)
        return undefined
      })
    }
    if (done) {
      note(input, `finish pull ${pairText(done)}`)
      input.onPair?.(done)
    }
    if (!terminal(done?.status) && (done?.status === "claimed" || relayDone?.status === "claimed")) {
      note(input, "finish pull relay")
      const relay = await pullRelay(input, pair.id)
      limitedHit = limitedHit || relay.limited
      relayDone = relay.pair ?? relayDone
      synced = await syncPair(input, relayDone)
      done = synced?.pair ?? done
    }
    if (!terminal(done?.status)) {
      note(input, "finish wait native")
      const native = await waitDone(input)
      limitedHit = limitedHit || native.limited
      done = native.pair
    }
    if (!terminal(done?.status)) {
      note(input, limitedHit ? "finish relay once" : "finish wait relay")
      const relay = limitedHit ? await pullRelay(input, pair.id) : await waitRelayDone(input, pair.id)
      limitedHit = limitedHit || relay.limited
      relayDone = relay.pair
      synced = await syncPair(input, relayDone)
      done = synced?.pair ?? done
    } else {
      done = synced?.pair ?? done
    }
    push = synced?.push ?? (await pull(platform))
    note(input, `finish push ${pushText(push)}`)

    if (push?.paired || done?.status === "active") {
      const next: PairInfo = {
        ...(pair ?? {}),
        ...(done ?? {}),
        id: done?.id ?? pair.id,
        status: "active",
        token: undefined,
        message: undefined,
        channel: done?.channel ?? pair.channel,
        device: done?.device ?? pair.device,
      }
      input.onPair?.(next)
      note(input, `success ${pairText(next)} ${pushText(push)}`)
      return {
        ok: true,
        pair: next,
        push,
      }
    }

    if (done?.status === "expired") {
      throw fail("pair_expired", "This pairing request expired before the iPhone finished syncing.")
    }
    if (done?.status === "failed") {
      throw fail("pair_failed", done.message || "The OpenCode host could not finish pairing this iPhone.")
    }
    if (limitedHit) {
      throw fail("relay_rate_limited", limitMessage())
    }
    throw fail(
      "pair_claim_timeout",
      "The OpenCode host claimed the pair, but this iPhone has not finished syncing yet.",
    )
  } catch (err) {
    note(input, `fail phase=${phase ?? "-"} err=${text(err)}`)
    push = (await pull(platform).catch(() => undefined)) ?? push
    note(input, `fail push ${pushText(push)}`)
    throw new PushFail(errIssue(err, push, phase))
  } finally {
    note(input, `stop phase=${phase ?? "-"}`)
    input.onPhase?.()
  }
}
