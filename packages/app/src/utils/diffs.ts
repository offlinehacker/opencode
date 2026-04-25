import type { SnapshotFileDiff, VcsFileDiff } from "@opencode-ai/sdk/v2"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { formatPatch, structuredPatch } from "diff"

type Diff = SnapshotFileDiff | VcsFileDiff

function status(value: unknown): value is Diff["status"] {
  return value === undefined || value === "added" || value === "deleted" || value === "modified"
}

function complete(value: unknown): value is Diff {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  if (!("file" in value) || typeof value.file !== "string") return false
  if (!("patch" in value) || typeof value.patch !== "string") return false
  if (!("additions" in value) || typeof value.additions !== "number") return false
  if (!("deletions" in value) || typeof value.deletions !== "number") return false
  return !("status" in value) || status(value.status)
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function normalize(value: unknown): Diff | undefined {
  if (complete(value)) return value
  if (!object(value)) return
  if (typeof value.file !== "string") return
  if (typeof value.before !== "string" || typeof value.after !== "string") return
  if (typeof value.additions !== "number" || typeof value.deletions !== "number") return
  if (!status(value.status)) return

  return {
    file: value.file,
    patch: formatPatch(
      structuredPatch(value.file, value.file, value.before, value.after, "", "", { context: Number.MAX_SAFE_INTEGER }),
    ),
    additions: value.additions,
    deletions: value.deletions,
    status: value.status,
  }
}

export function diffs(value: unknown): Diff[] {
  if (Array.isArray(value) && value.every(complete)) return value
  if (Array.isArray(value)) return value.flatMap((item) => normalize(item) ?? [])
  const item = normalize(value)
  if (item) return [item]
  if (!object(value)) return []
  return Object.values(value).flatMap((item) => normalize(item) ?? [])
}

export function message(value: Message): Message {
  if (value.role !== "user") return value

  const raw = value.summary as unknown
  if (raw === undefined) return value
  if (!object(raw)) return { ...value, summary: undefined }

  const title = typeof raw.title === "string" ? raw.title : undefined
  const body = typeof raw.body === "string" ? raw.body : undefined
  const next = diffs(raw.diffs)

  if (title === raw.title && body === raw.body && next === raw.diffs) return value

  return {
    ...value,
    summary: {
      ...(title === undefined ? {} : { title }),
      ...(body === undefined ? {} : { body }),
      diffs: next,
    },
  }
}
