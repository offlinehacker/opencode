import type { Part } from "@opencode-ai/sdk/v2"

const hidden = new Set(["todowrite"])

export function partRenderable(part: Part, _showReasoningSummaries = true) {
  if (part.type === "tool") {
    if (hidden.has(part.tool)) return false
    if (part.tool === "question") return part.state.status !== "pending" && part.state.status !== "running"
    return true
  }
  if (part.type === "text" || part.type === "reasoning") return !!part.text?.trim()
  return undefined
}

export function partDefaultOpen(part: Part, shell = false, edit = false, reasoning = false) {
  if (part.type === "reasoning") return reasoning
  if (part.type !== "tool") return
  if (part.tool === "bash") return shell
  if (part.tool === "edit" || part.tool === "write" || part.tool === "apply_patch") return edit
}

export function isReasoningSummary(part: Part) {
  if (part.type !== "reasoning" || !part.metadata) return false
  return Object.values(part.metadata).some((value) => {
    if (!value || typeof value !== "object" || !("itemId" in value)) return false
    return typeof value.itemId === "string" && value.itemId.startsWith("rs_")
  })
}
