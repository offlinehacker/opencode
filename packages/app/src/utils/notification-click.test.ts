import { afterEach, describe, expect, test } from "bun:test"
import { handleNotificationClick, setNavigate, setNotificationOpen } from "./notification-click"

describe("notification click", () => {
  afterEach(() => {
    setNavigate(undefined as any)
    setNotificationOpen((() => {}) as any)
    setNotificationOpen(undefined as any)
  })

  test("navigates via registered navigate function", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick("/abc/session/123")
    expect(calls).toEqual(["/abc/session/123"])
  })

  test("does not navigate when href is missing", () => {
    const calls: string[] = []
    setNavigate((href) => calls.push(href))
    handleNotificationClick(undefined)
    expect(calls).toEqual([])
  })

  test("falls back to location.assign without registered navigate", () => {
    handleNotificationClick("/abc/session/123")
    // falls back to window.location.assign — no error thrown
  })

  test("routes rich payloads through the registered handler", () => {
    const calls: Array<{ channel?: string; session?: string }> = []
    setNotificationOpen((value) => calls.push({ channel: value.channel, session: value.session }))
    handleNotificationClick({ channel: "ch_1", session: "ses_1" })
    expect(calls).toEqual([{ channel: "ch_1", session: "ses_1" }])
  })

  test("queues rich payloads until the handler is ready", () => {
    handleNotificationClick({ channel: "ch_2", session: "ses_2" })
    const calls: Array<{ channel?: string; session?: string }> = []
    setNotificationOpen((value) => calls.push({ channel: value.channel, session: value.session }))
    expect(calls).toEqual([{ channel: "ch_2", session: "ses_2" }])
  })
})
