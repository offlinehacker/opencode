import { describe, expect, test } from "bun:test"
import type { SnapshotFileDiff } from "@opencode-ai/sdk/v2"
import type { Message } from "@opencode-ai/sdk/v2/client"
import { diffs, message } from "./diffs"
import { diffCount, MOBILE_REVIEW_FILE_LIMIT, mobileReviewLimit } from "./mobile-review-limit"

const item = {
  file: "src/app.ts",
  patch: "@@ -1 +1 @@\n-old\n+new\n",
  additions: 1,
  deletions: 1,
  status: "modified",
} satisfies SnapshotFileDiff

const legacy = {
  file: "Java.md",
  before: "",
  after: "# Java\n\nA poem\n",
  additions: 3,
  deletions: 0,
  status: "added",
}

describe("diffs", () => {
  test("keeps valid arrays", () => {
    expect(diffs([item])).toEqual([item])
  })

  test("wraps a single diff object", () => {
    expect(diffs(item)).toEqual([item])
  })

  test("reads keyed diff objects", () => {
    expect(diffs({ a: item })).toEqual([item])
  })

  test("normalizes legacy before/after diffs", () => {
    expect(diffs([legacy])).toEqual([
      expect.objectContaining({
        file: "Java.md",
        additions: 3,
        deletions: 0,
        status: "added",
        patch: expect.stringContaining("+A poem"),
      }),
    ])
  })

  test("drops invalid entries", () => {
    expect(
      diffs([
        item,
        { file: "src/bad.ts", additions: 1, deletions: 1 },
        { patch: item.patch, additions: 1, deletions: 1 },
      ]),
    ).toEqual([item])
  })
})

describe("message", () => {
  test("normalizes user summaries with object diffs", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: {
        title: "Edit",
        diffs: { a: item },
      },
    } as unknown as Message

    expect(message(input)).toMatchObject({
      summary: {
        title: "Edit",
        diffs: [item],
      },
    })
  })

  test("drops invalid user summaries", () => {
    const input = {
      id: "msg_1",
      sessionID: "ses_1",
      role: "user",
      time: { created: 1 },
      agent: "build",
      model: { providerID: "openai", modelID: "gpt-5" },
      summary: true,
    } as unknown as Message

    expect(message(input)).toMatchObject({ summary: undefined })
  })
})

describe("mobileReviewLimit", () => {
  test("counts raw diff containers without normalizing them", () => {
    expect(diffCount([item, legacy])).toBe(2)
    expect(diffCount({ a: item, b: legacy })).toBe(2)
  })

  test("allows the configured limit on mobile", () => {
    expect(mobileReviewLimit(MOBILE_REVIEW_FILE_LIMIT, true)).toBeUndefined()
  })

  test("blocks more than the configured limit on mobile", () => {
    expect(mobileReviewLimit(MOBILE_REVIEW_FILE_LIMIT + 1, true)).toEqual({
      count: MOBILE_REVIEW_FILE_LIMIT + 1,
      limit: MOBILE_REVIEW_FILE_LIMIT,
    })
  })

  test("does not block desktop", () => {
    expect(mobileReviewLimit(MOBILE_REVIEW_FILE_LIMIT + 1, false)).toBeUndefined()
  })
})
