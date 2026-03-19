import type { PairInfo, Platform, PushState } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { pairPush, PushPlugin } from "@/utils/push-plugin"
import { serverAuthHeaders } from "@/utils/server"

const PTY_TIMEOUT = 60_000
const CLAIM_WAIT = 5_000
const CLAIM_POLL = 500
const FETCH_MS = 10_000
const OUT_LIMIT = 2_000
const WAIT_MS = 15_000
const WAIT_GAP = 500

type PathRes = {
  state?: string
  directory?: string
}

type Runner = {
  name: "npx" | "bunx"
  command: string
  args: string[]
}

type PairRes = {
  status?: "pending" | "claimed" | "active" | "expired" | "failed"
  message?: string
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

type Pull = Pick<
  Platform,
  "beginPushPairing" | "getPushPairing" | "getPushState" | "pushState" | "requestPushPermission"
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

function install(token: string, relay?: string) {
  const args = ["install", "--pair", token, "--json"]
  if (relay) args.push("--relay", relay)
  return args
}

function npx(token: string, prefix?: string, relay?: string): Runner | undefined {
  if (!prefix) return
  return {
    name: "npx",
    command: "npx",
    args: ["--yes", "--prefix", prefix, "--package", PushPlugin.spec, PushPlugin.bin, ...install(token, relay)],
  }
}

function bunx(token: string, relay?: string): Runner {
  return {
    name: "bunx",
    command: "bunx",
    args: [PushPlugin.spec, ...install(token, relay)],
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
  const cmd = text.includes('"cmd": "install"') || text.includes("cmd: install")
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
    case "relay_timeout":
      return issue(
        "relay_unreachable",
        push.diag.lastError ?? "The push relay timed out. Check that the relay is reachable and try again.",
      )
    case "bad_reply":
    case "bad_pair":
    case "decode":
    case "relay_error":
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
  return input.platform.getPushPairing?.().catch(() => undefined)
}

async function waitPush(input: PushSetupInput) {
  const end = Date.now() + WAIT_MS
  for (;;) {
    const push = await pull(input.platform)
    const next = pushIssue(push)
    if (next?.code === "apns_register_failed" || next?.code === "missing_token") {
      throw new PushFail(next)
    }
    if (push?.permission === "denied") {
      throw fail("permission_denied", "Turn on notifications for WhisperCode in the iPhone Settings app.")
    }
    if (push?.allowed && push.registered) return push
    if (Date.now() >= end) {
      if (!push?.allowed) {
        throw fail("permission_required", "Enable notifications for WhisperCode to finish setup.")
      }
      if (next) {
        throw new PushFail(next)
      }
      throw fail("apns_register_timeout", "WhisperCode is still waiting for Apple push registration.")
    }
    await wait(WAIT_GAP)
  }
}

async function waitDone(input: PushSetupInput) {
  const end = Date.now() + WAIT_MS
  let last: PairInfo | undefined
  for (;;) {
    const next = await pullPair(input)
    if (next) {
      last = next
      input.onPair?.(next)
      if (next.status === "active" || next.status === "expired" || next.status === "failed") {
        return next
      }
    }
    if (Date.now() >= end) return last
    await wait(WAIT_GAP)
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

function watchPty(conn: ServerConnection.Any, id: string): Stream {
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
      failed = new Error("Push pairing command stream failed. Check that the host is reachable and try again.")
    }
    const onClose = () => {
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

async function readPair(fetch: typeof globalThis.fetch, relay: string, pairId: string): Promise<PairRes> {
  const res = await fetchWithTimeout(
    fetch,
    new URL(`/v1/pair/${encodeURIComponent(pairId)}`, relay),
    {},
    "Push pairing relay check",
  )
  if (!res.ok) {
    throw new Error(`Push pairing relay check failed: ${res.status}`)
  }
  return (await res.json()) as PairRes
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

async function waitClaim(
  fetch: typeof globalThis.fetch,
  relay: string,
  pairId: string,
  ms = CLAIM_WAIT,
): Promise<PairRes | undefined> {
  const deadline = Date.now() + ms
  let last: PairRes | undefined
  let err: unknown
  while (Date.now() < deadline) {
    try {
      last = await readPair(fetch, relay, pairId)
      err = undefined
    } catch (cause) {
      err = cause
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
}) {
  const conn = input.server
  if (!conn) {
    throw fail("server_required", "Connect to an OpenCode server first.")
  }

  const fetch = input.platform.fetch ?? globalThis.fetch
  const relay = input.relay
  const pairId = input.pairId
  const path = await readPath(fetch, conn)
    .catch(() => undefined)
  const prefix = path?.state
  const cwd = path?.directory
  const runs = [npx(input.token, prefix, relay), bunx(input.token, relay)].filter((item) => !!item)
  let last: PushFail | undefined

  for (const runner of runs) {
    let id: string
    try {
      id = await runPty(fetch, conn, runner.command, runner.args, cwd)
    } catch (err) {
      throw fail("host_install_failed", text(err))
    }

    const stream = watchPty(conn, id)

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
    for (;;) {
      if (Date.now() >= deadline) {
        stream.close()
        throw fail(
          "host_install_failed",
          "Push pairing command timed out. Check that the host is reachable and try again.",
        )
      }
      const pair = await readPair(fetch, relay, pairId).catch(() => undefined)
      if (pair?.status === "active" || pair?.status === "claimed") {
        stream.close()
        return { ok: true }
      }
      if (pair?.status === "failed") {
        stream.close()
        throw fail("pair_failed", pair.message || "The relay reported that push pairing failed.")
      }
      if (pair?.status === "expired") {
        stream.close()
        throw fail("pair_expired", "This pairing request expired before the host finished installing the push plugin.")
      }
      if (done) break
      await Promise.race([stream.done, wait(CLAIM_POLL)])
    }

    const result = done ?? (await stream.done)
    const out = clip(result.out)
    const good = okRun(out)
    const pair = await waitClaim(fetch, relay, pairId, good || result.error ? WAIT_MS : out ? CLAIM_POLL : CLAIM_WAIT)
    if (pair?.status === "active" || pair?.status === "claimed") {
      return { ok: true }
    }
    if (pair?.status === "expired") {
      throw fail("pair_expired", "This pairing request expired before the host finished installing the push plugin.")
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
      break
    }
    if (out) {
      last = fail("host_install_failed", failRun(runner.name, result.out), clip(result.out) || undefined)
      continue
    }
    if (result.error) {
      last = fail("host_install_failed", result.error.message)
      continue
    }
    last = fail("pair_claim_timeout", `Push pairing command ended via ${runner.name}, but the relay never observed the claim.`)
  }

  if (last) throw last
  throw fail(
    "host_install_failed",
    `The OpenCode notification plugin failed to install. Run ${pairPush(input.token, relay)} or ${pairPush(input.token, relay, "bunx")} on the host and try again.`,
  )
}

export async function runPushSetup(input: PushSetupInput): Promise<PushSetupResult> {
  const platform = input.platform
  if (!platform.beginPushPairing || !platform.getPushPairing || !platform.getPushState) {
    throw fail("unsupported", "Push pairing is unavailable on this device.")
  }

  let push = await pull(platform)
  let phase: PushPhase | undefined

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
      push = await platform.requestPushPermission()
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
      push = await waitPush(input)
    }

    if (!input.server) {
      throw fail("server_required", "Connect to an OpenCode server first.")
    }

    let pair = reuse(input.pair, input.relay)
    if (!pair) {
      phase = "begin"
      input.onPhase?.(phase)
      pair = await platform.beginPushPairing()
      pair = { ...pair, command: pairCmd(pair.token, input.relay, pair.command) }
      input.onPair?.(pair)
    }

    if (!pair.token) {
      const next = await pullPair(input)
      if (next) {
        pair = { ...next, command: pairCmd(next.token, input.relay, next.command) }
        input.onPair?.(pair)
      }
    }

    if (!pair.token) {
      throw fail("pair_token_missing", "Push pairing token unavailable.")
    }

    phase = "claim"
    input.onPhase?.(phase)
    await claimPush({
      platform,
      server: input.server,
      token: pair.token,
      relay: input.relay,
      pairId: pair.id,
    })

    phase = "finish"
    input.onPhase?.(phase)
    const done = await waitDone(input)
    push = await pull(platform)

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
    throw fail(
      "pair_claim_timeout",
      "The OpenCode host claimed the pair, but this iPhone has not finished syncing yet.",
    )
  } catch (err) {
    push = (await pull(platform).catch(() => undefined)) ?? push
    throw new PushFail(errIssue(err, push, phase))
  } finally {
    input.onPhase?.()
  }
}
