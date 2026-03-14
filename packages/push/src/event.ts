import type { Event } from "@opencode-ai/sdk"
import { append, type Data, type Item, next, type Kind } from "./state"

type Status = { type: "idle" | "busy" | "retry" }

type Ses = {
  id: string
  parentID?: string
}

type Any =
  | Event
  | { type: "session.created"; properties: { info: Ses } }
  | { type: "session.updated"; properties: { info: Ses } }
  | { type: "session.deleted"; properties: { info: Ses } }
  | { type: "permission.asked"; properties: { id: string; sessionID: string } }
  | { type: "question.asked"; properties: { id: string; sessionID: string } }
  | { type: "session.status"; properties: { sessionID: string; status: Status } }
  | { type: "session.idle"; properties: { sessionID: string } }
  | { type: "session.error"; properties: { sessionID?: string } }

const cool: Record<Exclude<Kind, "test">, number> = {
  complete: 30_000,
  error: 30_000,
  approval: 15_000,
  question: 15_000,
}

function root(data: Data, id?: string | null) {
  if (!id) return true
  return data.root[id] !== false
}

export function sync(data: Data, evt: Any) {
  if (evt.type === "session.created" || evt.type === "session.updated") {
    data.root[evt.properties.info.id] = !evt.properties.info.parentID
    return
  }
  if (evt.type === "session.deleted") {
    delete data.root[evt.properties.info.id]
  }
}

export function map(data: Data, evt: Any): Item | undefined {
  if (evt.type === "session.status") {
    if (evt.properties.status.type !== "idle") return
    if (!root(data, evt.properties.sessionID)) return
    return gate(data, "complete", evt.properties.sessionID)
  }

  if (evt.type === "session.idle") {
    if (!root(data, evt.properties.sessionID)) return
    return gate(data, "complete", evt.properties.sessionID)
  }

  if (evt.type === "session.error") {
    if (!root(data, evt.properties.sessionID)) return
    return gate(data, "error", evt.properties.sessionID)
  }

  if (evt.type === "permission.asked") {
    if (!root(data, evt.properties.sessionID)) return
    return gate(data, "approval", evt.properties.sessionID, evt.properties.id)
  }

  if (evt.type === "question.asked") {
    if (!root(data, evt.properties.sessionID)) return
    return gate(data, "question", evt.properties.sessionID, evt.properties.id)
  }
}

export async function record(data: Data, evt: Any) {
  sync(data, evt)
  const item = map(data, evt)
  if (!item) return
  data.last = item
  data.updated_at = Date.now()
  await append(item)
  return item
}

function gate(data: Data, kind: Exclude<Kind, "test">, session?: string | null, req?: string | null) {
  const item = next(kind, session, req)
  const last = data.cool[item.collapse_id] ?? 0
  if (item.occurred_at - last < cool[kind]) return
  data.cool[item.collapse_id] = item.occurred_at
  return item
}
