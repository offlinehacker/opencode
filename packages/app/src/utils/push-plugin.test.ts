import { describe, expect, test } from "bun:test"
import { addPush, dropPush, hasPush, hasPushSpec, installPrompt, installPush, pairPush, PushPlugin } from "./push-plugin"

describe("push plugin", () => {
  test("uses the override spec when provided", () => {
    const prev = import.meta.env.VITE_WHISPEROPENCODE_PUSH_SPEC
    const prevPlugin = import.meta.env.VITE_WHISPEROPENCODE_PUSH_PLUGIN
    ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_SPEC?: string }).VITE_WHISPEROPENCODE_PUSH_SPEC =
      "@whisperopencode/push@0.2.99-phone.1"
    ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_PLUGIN?: string }).VITE_WHISPEROPENCODE_PUSH_PLUGIN =
      undefined
    try {
      expect(PushPlugin.spec).toBe("@whisperopencode/push@0.2.99-phone.1")
      expect(PushPlugin.plugin).toBe("@whisperopencode/push@0.2.99-phone.1")
      expect(addPush(["foo@1.0.0"])).toEqual(["foo@1.0.0", "@whisperopencode/push@0.2.99-phone.1"])
      expect(installPush()).toBe(
        "npx --yes --prefix . --package=@whisperopencode/push@0.2.99-phone.1 opencode-push install",
      )
      expect(pairPush("ptok_1", "https://relay.example.com", "bunx")).toBe(
        "bunx @whisperopencode/push@0.2.99-phone.1 pair --pair ptok_1 --relay https://relay.example.com",
      )
      expect(installPrompt()).toBe(
        "Run this exact command on the machine hosting OpenCode and report whether it succeeded: npx --yes --prefix . --package=@whisperopencode/push@0.2.99-phone.1 opencode-push install",
      )
    } finally {
      ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_SPEC?: string }).VITE_WHISPEROPENCODE_PUSH_SPEC =
        prev
      ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_PLUGIN?: string }).VITE_WHISPEROPENCODE_PUSH_PLUGIN =
        prevPlugin
    }
  })

  test("allows a separate plugin target when the cli uses a local path", () => {
    const prev = import.meta.env.VITE_WHISPEROPENCODE_PUSH_SPEC
    const prevPlugin = import.meta.env.VITE_WHISPEROPENCODE_PUSH_PLUGIN
    ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_SPEC?: string }).VITE_WHISPEROPENCODE_PUSH_SPEC =
      "/tmp/push-host"
    ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_PLUGIN?: string }).VITE_WHISPEROPENCODE_PUSH_PLUGIN =
      "file:///tmp/push-host/dist/src/index.js"
    try {
      expect(PushPlugin.spec).toBe("/tmp/push-host")
      expect(PushPlugin.plugin).toBe("file:///tmp/push-host/dist/src/index.js")
      expect(PushPlugin.local(PushPlugin.spec)).toBe(true)
      expect(hasPushSpec([PushPlugin.plugin])).toBe(true)
      expect(addPush(["@whisperopencode/push@0.1.0"])).toEqual(["file:///tmp/push-host/dist/src/index.js"])
      expect(installPush()).toBe("npx --yes --prefix . --package=/tmp/push-host opencode-push install")
      expect(installPush("bunx")).toBe("npx --yes --prefix . --package=/tmp/push-host opencode-push install")
      expect(pairPush("ptok_1", "https://relay.example.com", "bunx")).toBe(
        "npx --yes --prefix . --package=/tmp/push-host opencode-push pair --pair ptok_1 --relay https://relay.example.com",
      )
    } finally {
      ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_SPEC?: string }).VITE_WHISPEROPENCODE_PUSH_SPEC =
        prev
      ;(import.meta.env as ImportMetaEnv & { VITE_WHISPEROPENCODE_PUSH_PLUGIN?: string }).VITE_WHISPEROPENCODE_PUSH_PLUGIN =
        prevPlugin
    }
  })

  test("detects installed package by package name", () => {
    expect(hasPush(["@whisperopencode/push@0.1.0"])).toBe(true)
    expect(hasPush(["foo@1.0.0"])).toBe(false)
  })

  test("detects the exact configured package spec", () => {
    expect(hasPushSpec([PushPlugin.spec])).toBe(true)
    expect(hasPushSpec(["@whisperopencode/push"])).toBe(PushPlugin.spec === "@whisperopencode/push")
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

  test("uses the relay-issued install command when provided", () => {
    expect(installPrompt("bunx @whisperopencode/push pair --pair ptok_1")).toBe(
      "Run this exact command on the machine hosting OpenCode and report whether it succeeded: bunx @whisperopencode/push pair --pair ptok_1",
    )
  })

  test("builds the exact paired install command locally", () => {
    expect(pairPush("ptok_1")).toBe(`npx --yes --prefix . --package=${PushPlugin.spec} opencode-push pair --pair ptok_1`)
    expect(pairPush("ptok_1", "https://relay.example.com", "bunx")).toBe(
      `bunx ${PushPlugin.spec} pair --pair ptok_1 --relay https://relay.example.com`,
    )
  })
})
