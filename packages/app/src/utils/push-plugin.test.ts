import { describe, expect, test } from "bun:test"
import { addPush, dropPush, hasPush, installPrompt, installPush, PushPlugin } from "./push-plugin"

describe("push plugin", () => {
  test("detects installed package by package name", () => {
    expect(hasPush(["@whispercode/opencode-push@0.1.0"])).toBe(true)
    expect(hasPush(["foo@1.0.0"])).toBe(false)
  })

  test("adds package idempotently", () => {
    expect(addPush(["foo@1.0.0", "@whispercode/opencode-push@0.1.0"])).toEqual(["foo@1.0.0", PushPlugin.spec])
  })

  test("drops package by package name", () => {
    expect(dropPush([PushPlugin.spec, "foo@1.0.0"])).toEqual(["foo@1.0.0"])
  })

  test("returns the manual install command", () => {
    expect(installPush()).toBe("bunx @whispercode/opencode-push install")
  })

  test("returns the exact agent install prompt", () => {
    expect(installPrompt()).toBe(
      "Run this exact command on the machine hosting OpenCode and report whether it succeeded: bunx @whispercode/opencode-push install",
    )
  })

  test("uses the relay-issued install command when provided", () => {
    expect(installPrompt("bunx @whispercode/opencode-push install --pair ptok_1")).toBe(
      "Run this exact command on the machine hosting OpenCode and report whether it succeeded: bunx @whispercode/opencode-push install --pair ptok_1",
    )
  })
})
