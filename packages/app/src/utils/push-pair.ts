import type { Platform } from "@/context/platform"
import type { ServerConnection } from "@/context/server"
import { installPush, PushPlugin } from "@/utils/push-plugin"
import { serverAuthHeaders } from "@/utils/server"

const PTY_TIMEOUT = 60_000
const PTY_POLL = 1_000
const CLAIM_WAIT = 5_000
const CLAIM_POLL = 500
const FETCH_MS = 10_000
const OUT_LIMIT = 2_000

type PathRes = {
  state?: string
}

type Runner = {
  name: "npx" | "bunx"
  command: string
  args: string[]
}

type Run = {
  code: number
  out: string
}

type PtyRes =
  | {
      status: "running"
    }
  | {
      status: "exited"
      exitCode: number
      output: string
    }

type PairRes = {
  status?: "pending" | "claimed" | "active" | "expired" | "failed"
  message?: string
}

function install(token: string, relay?: string) {
  const args = ["install", "--pair", token]
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

async function runPty(fetch: typeof globalThis.fetch, conn: ServerConnection.Any, command: string, args: string[]) {
  const res = await fetchWithTimeout(
    fetch,
    new URL("/pty", conn.http.url),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...serverAuthHeaders(conn.http),
      },
      body: JSON.stringify({ command, args }),
    },
    "Push pairing command",
  )

  if (!res.ok) {
    throw new Error(`push pair failed: ${res.status}`)
  }

  const pty = (await res.json()) as { id: string }

  const deadline = Date.now() + PTY_TIMEOUT
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PTY_POLL))
    const check = await fetchWithTimeout(
      fetch,
      new URL(`/pty/${pty.id}/result`, conn.http.url),
      {
        headers: serverAuthHeaders(conn.http),
      },
      "Push pairing status check",
    )

    if (!check.ok) {
      throw new Error("Push pairing command result was lost before it could be read.")
    }

    const body = (await check.json()) as PtyRes
    if (body.status === "running") {
      continue
    }
    return {
      code: body.exitCode,
      out: body.output,
    }
  }

  throw new Error("Push pairing command timed out. Check that the host is reachable and try again.")
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

async function waitPair(fetch: typeof globalThis.fetch, relay: string, pairId: string): Promise<PairRes | undefined> {
  const deadline = Date.now() + CLAIM_WAIT
  let last: PairRes | undefined
  while (Date.now() < deadline) {
    last = await readPair(fetch, relay, pairId).catch(() => last)
    if (!last?.status || last.status === "pending") {
      await new Promise((r) => setTimeout(r, CLAIM_POLL))
      continue
    }
    return last
  }
  return last
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

export async function claimPush(input: {
  platform: Pick<Platform, "fetch">
  server?: ServerConnection.Any
  token: string
  relay?: string
  pairId?: string
}) {
  const conn = input.server
  if (!conn) {
    throw new Error("Connect to an OpenCode server first")
  }

  const fetch = input.platform.fetch ?? globalThis.fetch
  const relay = input.relay
  const pairId = input.pairId
  const prefix = await readPath(fetch, conn)
    .then((item) => item?.state)
    .catch(() => undefined)
  const runs = [npx(input.token, prefix, relay), bunx(input.token, relay)].filter((item) => !!item)
  let last = ""

  for (const runner of runs) {
    const run = await runPty(fetch, conn, runner.command, runner.args)
    if (run.code !== 0) {
      last = failRun(runner.name, run.out)
      continue
    }

    if (!relay || !pairId) {
      return { ok: true }
    }

    const pair = await waitPair(fetch, relay, pairId)
    if (pair?.status === "active" || pair?.status === "claimed") {
      return { ok: true }
    }
    if (pair?.status === "failed") {
      throw new Error(pair.message || "The relay reported that push pairing failed.")
    }
    if (pair?.status === "expired") {
      throw new Error("This pairing request expired before the host finished installing the push plugin.")
    }
    last = `Push pairing command exited successfully via ${runner.name}, but the relay never observed the claim.`
  }

  throw new Error(
    last ||
      `The OpenCode notification plugin failed to install. Install it manually with: ${installPush()} or ${installPush("bunx")}`,
  )
}
