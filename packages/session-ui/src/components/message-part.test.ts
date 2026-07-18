import { describe, expect, test } from "bun:test"
import type { ReasoningPart } from "@opencode-ai/sdk/v2"
import { isReasoningSummary, partDefaultOpen, partRenderable } from "./message-part-display"
import { readPartText } from "./message-part-text"

describe("readPartText", () => {
  test("returns empty string when accum is undefined and part text is undefined", () => {
    expect(readPartText(undefined, { id: "part_1" })).toBe("")
  })

  test("returns trimmed part text when accum is undefined", () => {
    expect(readPartText(undefined, { id: "part_1", text: "  hello  " })).toBe("hello")
  })

  test("prefers accum value over part text when accum has a hit", () => {
    expect(readPartText({ part_1: "  from accum  " }, { id: "part_1", text: "from part" })).toBe("from accum")
  })

  test("falls back to part text when accum misses", () => {
    expect(readPartText({ other_part: "ignored" }, { id: "part_1", text: "  from part  " })).toBe("from part")
  })

  test("returns empty string for whitespace-only text", () => {
    expect(readPartText(undefined, { id: "part_1", text: "   \n\t  " })).toBe("")
  })

  test("trims leading and trailing whitespace", () => {
    expect(readPartText(undefined, { id: "part_1", text: "\n  body  \n" })).toBe("body")
  })
})

describe("reasoning display", () => {
  const reasoning = {
    id: "part_reasoning",
    sessionID: "session_1",
    messageID: "message_1",
    type: "reasoning",
    text: "Summary of the model reasoning",
    time: { start: 0, end: 1 },
  } satisfies ReasoningPart

  test("keeps reasoning summaries renderable regardless of the display preference", () => {
    expect(partRenderable(reasoning, true)).toBe(true)
    expect(partRenderable(reasoning, false)).toBe(true)
  })

  test("uses the display preference as the initial expanded state", () => {
    expect(partDefaultOpen(reasoning, false, false, true)).toBe(true)
    expect(partDefaultOpen(reasoning, false, false, false)).toBe(false)
  })

  test("recognizes OpenAI Responses reasoning summaries", () => {
    expect(isReasoningSummary({ ...reasoning, metadata: { openai: { itemId: "rs_123" } } })).toBe(true)
    expect(isReasoningSummary({ ...reasoning, metadata: { anthropic: { signature: "signed" } } })).toBe(false)
  })
})
