import { describe, expect, test } from "bun:test"
import { terminalTouchScrollAmount } from "./terminal"

describe("terminalTouchScrollAmount", () => {
  test("maps a downward drag to upward terminal scrollback", () => {
    expect(terminalTouchScrollAmount({ deltaY: 32, lineHeight: 16, remainder: 0 })).toEqual({
      amount: -2,
      remainder: 0,
    })
  })

  test("maps an upward drag back toward the terminal bottom", () => {
    expect(terminalTouchScrollAmount({ deltaY: -32, lineHeight: 16, remainder: 0 })).toEqual({
      amount: 2,
      remainder: 0,
    })
  })

  test("accumulates sub-line touch movement", () => {
    const first = terminalTouchScrollAmount({ deltaY: 6, lineHeight: 16, remainder: 0 })
    expect(first).toEqual({
      amount: 0,
      remainder: 0.375,
    })

    expect(terminalTouchScrollAmount({ deltaY: 11, lineHeight: 16, remainder: first.remainder })).toEqual({
      amount: -1,
      remainder: 0.0625,
    })
  })

  test("uses a minimum line height for tiny measurements", () => {
    expect(terminalTouchScrollAmount({ deltaY: 16, lineHeight: 0, remainder: 0 })).toEqual({
      amount: -2,
      remainder: 0,
    })
  })
})
