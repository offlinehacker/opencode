import { describe, expect, test } from "bun:test"
import { cut, merge } from "./config"

describe("push config", () => {
  test("dedupes package entries by package name", () => {
    const list = merge(["@whisperopencode/push@0.1.0"], "@whisperopencode/push@0.x")
    expect(list).toEqual(["@whisperopencode/push@0.x"])
  })

  test("removes package entries by package name", () => {
    const list = cut(["@whisperopencode/push@0.x", "foo@1.0.0"], "@whisperopencode/push")
    expect(list).toEqual(["foo@1.0.0"])
  })
})
