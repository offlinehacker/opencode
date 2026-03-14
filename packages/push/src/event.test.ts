import { describe, expect, test } from "bun:test"
import { map, sync } from "./event"
import type { Data } from "./state"

function data(): Data {
  return {
    v: 1,
    mode: "local",
    root: {},
    cool: {},
  }
}

describe("push event map", () => {
  test("records root sessions from create events", () => {
    const store = data()
    sync(store, {
      type: "session.created",
      properties: {
        info: { id: "ses_1" },
      },
    })
    expect(store.root.ses_1).toBe(true)
  })

  test("filters child session idle events", () => {
    const store = data()
    sync(store, {
      type: "session.created",
      properties: {
        info: { id: "ses_2", parentID: "ses_1" },
      },
    })
    const item = map(store, {
      type: "session.idle",
      properties: { sessionID: "ses_2" },
    })
    expect(item).toBeUndefined()
  })

  test("maps permission requests to approval", () => {
    const store = data()
    sync(store, {
      type: "session.created",
      properties: {
        info: { id: "ses_3" },
      },
    })
    const item = map(store, {
      type: "permission.asked",
      properties: { id: "req_1", sessionID: "ses_3" },
    })
    expect(item?.kind).toBe("approval")
    expect(item?.request_id).toBe("req_1")
  })

  test("applies cooldowns per collapse id", () => {
    const store = data()
    sync(store, {
      type: "session.created",
      properties: {
        info: { id: "ses_4" },
      },
    })
    const one = map(store, {
      type: "session.idle",
      properties: { sessionID: "ses_4" },
    })
    const two = map(store, {
      type: "session.idle",
      properties: { sessionID: "ses_4" },
    })
    expect(one?.kind).toBe("complete")
    expect(two).toBeUndefined()
  })
})
