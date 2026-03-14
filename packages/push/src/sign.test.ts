import { describe, expect, test } from "bun:test"
import { canonical, sign, signed } from "./sign"

describe("push sign", () => {
  test("canonical json sorts keys recursively", () => {
    expect(canonical({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}')
  })

  test("signature is stable across key order", () => {
    const one = sign("sec", { b: 1, a: 2 })
    const two = sign("sec", { a: 2, b: 1 })
    expect(one).toBe(two)
  })

  test("signed adds a detached signature field", () => {
    const body = signed("sec", { a: 1 })
    expect(body.sig).toBe(sign("sec", { a: 1 }))
  })
})
