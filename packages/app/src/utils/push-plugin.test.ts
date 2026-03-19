import { describe, expect, test } from "bun:test"
import { addPush, dropPush, hasPush, installPrompt, installPush, pairPush, PushPlugin } from "./push-plugin"

describe("push plugin", () => {
  test("detects installed package by package name", () => {
    expect(hasPush(["@whisperopencode/push@0.1.0"])).toBe(true)
    expect(hasPush(["foo@1.0.0"])).toBe(false)
  })

  test("adds package idempotently", () => {
    expect(addPush(["foo@1.0.0", "@whisperopencode/push@0.1.0"])).toEqual(["foo@1.0.0", PushPlugin.spec])
  })

  test("drops package by package name", () => {
    expect(dropPush([PushPlugin.spec, "foo@1.0.0"])).toEqual(["foo@1.0.0"])
  })

  test("returns the manual install command", () => {
    expect(installPush()).toBe("npx --yes --prefix . --package=@whisperopencode/push opencode-push install")
    expect(installPush("bunx")).toBe("bunx @whisperopencode/push install")
  })

  test("returns the exact agent install prompt", () => {
    expect(installPrompt()).toBe(
      "Run this exact command on the machine hosting OpenCode and report whether it succeeded: npx --yes --prefix . --package=@whisperopencode/push opencode-push install",
    )
  })

  test("uses the relay-issued install command when provided", () => {
    expect(installPrompt("bunx @whisperopencode/push install --pair ptok_1")).toBe(
      "Run this exact command on the machine hosting OpenCode and report whether it succeeded: bunx @whisperopencode/push install --pair ptok_1",
    )
  })

  test("builds the exact paired install command locally", () => {
    expect(pairPush("ptok_1")).toBe(
      "npx --yes --prefix . --package=@whisperopencode/push opencode-push install --pair ptok_1",
    )
    expect(pairPush("ptok_1", "https://relay.example.com", "bunx")).toBe(
      "bunx @whisperopencode/push install --pair ptok_1 --relay https://relay.example.com",
    )
  })
})
