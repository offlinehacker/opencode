import fs from "fs/promises"
import { randomUUID } from "crypto"
import { logFile, stateDir, stateFile } from "./path"

export type Kind = "complete" | "error" | "approval" | "question" | "test"

export type Item = {
  v: 1
  event_id: string
  kind: Kind
  session_id: string | null
  request_id: string | null
  occurred_at: number
  collapse_id: string
}

export type Relay = {
  url: string
  channel: string
  secret: string
  server?: string
  checked?: number
  result?: "accepted" | "suppressed" | "failed" | "ok"
  reason?: string
  delivery?: string
  err?: string
}

export type Data = {
  v: 1
  mode: "local" | "relay"
  root: Record<string, boolean>
  cool: Record<string, number>
  relay?: Relay
  last?: Item
  updated_at?: number
}

const init = (): Data => ({
  v: 1,
  mode: "local",
  root: {},
  cool: {},
})

export async function load() {
  const file = stateFile()
  const text = await fs.readFile(file, "utf8").catch(() => "")
  if (!text) return init()
  try {
    const data = JSON.parse(text) as Partial<Data>
    return {
      ...init(),
      ...data,
      root: data.root ?? {},
      cool: data.cool ?? {},
    } satisfies Data
  } catch {
    return init()
  }
}

export async function save(data: Data) {
  await fs.mkdir(stateDir(), { recursive: true })
  const file = stateFile()
  await fs.writeFile(file, JSON.stringify(data, null, 2) + "\n", "utf8")
  await fs.chmod(file, 0o600).catch(() => undefined)
}

export async function append(item: Item) {
  await fs.mkdir(stateDir(), { recursive: true })
  const file = logFile()
  await fs.appendFile(file, JSON.stringify(item) + "\n", "utf8")
  await fs.chmod(file, 0o600).catch(() => undefined)
}

export function next(kind: Kind, session?: string | null, req?: string | null): Item {
  const now = Date.now()
  const sid = session ?? null
  return {
    v: 1,
    event_id: randomUUID(),
    kind,
    session_id: sid,
    request_id: req ?? null,
    occurred_at: now,
    collapse_id: `${kind}:${sid ?? "global"}`,
  }
}
