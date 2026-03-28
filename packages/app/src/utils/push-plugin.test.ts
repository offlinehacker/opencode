import { describe, expect, test } from "bun:test"
import {
  addPush,
  dropPush,
  hasPush,
  hasPushSpec,
  installPair,
  installPrompt,
  installPush,
  pairPush,
  PushPlugin,
} from "./push-plugin"

describe("push plugin", () => {
  test("uses the latest push package", () => {
    expect(PushPlugin.spec).toBe(PushPlugin.pkg)
    expect(addPush(["foo@1.0.0"])).toEqual(["foo@1.0.0", PushPlugin.spec])
    expect(installPush()).toBe(`npx --yes --prefix . --package=${PushPlugin.spec} opencode-push install`)
    expect(pairPush("ptok_1", "https://relay.example.com", "bunx")).toBe(
      `bunx ${PushPlugin.spec} pair --pair ptok_1 --relay https://relay.example.com`,
    )
    expect(installPrompt()).toBe(
      `Run this exact command on the machine hosting OpenCode and report whether it succeeded: npx --yes --prefix . --package=${PushPlugin.spec} opencode-push install`,
    )
  })

  test("detects installed package by package name", () => {
    expect(hasPush(["@whisperopencode/push@0.1.0"])).toBe(true)
    expect(hasPush(["foo@1.0.0"])).toBe(false)
  })

  test("treats version-pinned entries as compatible by package name", () => {
    expect(hasPushSpec([PushPlugin.spec])).toBe(true)
    expect(hasPushSpec(["@whisperopencode/push@0.1.0"])).toBe(true)
    expect(hasPushSpec(["foo@1.0.0"])).toBe(false)
  })

  test("adds package idempotently", () => {
    expect(addPush(["foo@1.0.0", "@whisperopencode/push@0.1.0"])).toEqual(["foo@1.0.0", PushPlugin.spec])
  })

  test("drops package by package name", () => {
    expect(dropPush([PushPlugin.spec, "foo@1.0.0"])).toEqual(["foo@1.0.0"])
  })

  test("returns the manual install command", () => {
    expect(installPush()).toBe(`npx --yes --prefix . --package=${PushPlugin.spec} opencode-push install`)
    expect(installPush("bunx")).toBe(`bunx ${PushPlugin.spec} install`)
  })

  test("returns the exact agent install prompt", () => {
    expect(installPrompt()).toBe(
      `Run this exact command on the machine hosting OpenCode and report whether it succeeded: npx --yes --prefix . --package=${PushPlugin.spec} opencode-push install`,
    )
  })

  test("builds the legacy paired install command locally", () => {
    expect(installPair("ptok_1")).toBe(
      `npx --yes --prefix . --package=${PushPlugin.spec} opencode-push install --pair ptok_1`,
    )
    expect(installPair("ptok_1", "https://relay.example.com", "bunx")).toBe(
      `bunx ${PushPlugin.spec} install --pair ptok_1 --relay https://relay.example.com`,
    )
  })

  test("uses the relay-issued install command when provided", () => {
    expect(installPrompt("bunx @whisperopencode/push pair --pair ptok_1")).toBe(
      "Run this exact command on the machine hosting OpenCode and report whether it succeeded: bunx @whisperopencode/push pair --pair ptok_1",
    )
  })

  test("builds the exact paired install command locally", () => {
    expect(pairPush("ptok_1")).toBe(
      `npx --yes --prefix . --package=${PushPlugin.spec} opencode-push pair --pair ptok_1`,
    )
    expect(pairPush("ptok_1", "https://relay.example.com", "bunx")).toBe(
      `bunx ${PushPlugin.spec} pair --pair ptok_1 --relay https://relay.example.com`,
    )
  })
})
