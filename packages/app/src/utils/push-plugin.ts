// UPSTREAM-DIVERGENCE-FILE: Added after upstream sync 6b9ce5e63 to generate the install/pair commands
// for the fork's host-side push plugin. Keep this aligned with packages/push package naming.

import info from "../../../push/package.json"

const pkg = info.name
const spec = pkg
const bin = "opencode-push"

function relayArg(relay?: string) {
  return relay ? ` --relay ${relay}` : ""
}

export function installPrompt(value = installPush()) {
  return `Run this exact command on the machine hosting OpenCode and report whether it succeeded: ${value}`
}

type PluginEntry = string | [string, { [key: string]: unknown }]

function name(value: PluginEntry) {
  const item = Array.isArray(value) ? value[0] : value
  const idx = item.lastIndexOf("@")
  if (idx > 0) return item.slice(0, idx)
  return item
}

export function hasPush(list?: PluginEntry[]) {
  return (list ?? []).some((item) => name(item) === pkg)
}

export function hasPushSpec(list?: PluginEntry[]) {
  return hasPush(list)
}

export function addPush(list?: string[]): string[]
export function addPush(list?: PluginEntry[]): PluginEntry[]
export function addPush(list?: PluginEntry[]) {
  const next = (list ?? []).filter((item) => name(item) !== pkg)
  next.push(spec)
  return next
}

export function dropPush(list?: string[]): string[]
export function dropPush(list?: PluginEntry[]): PluginEntry[]
export function dropPush(list?: PluginEntry[]) {
  return (list ?? []).filter((item) => item !== spec && name(item) !== pkg)
}

export function installPush(tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") return `bunx ${spec} install`
  return `npx --yes --prefix . --package=${spec} ${bin} install`
}

export function installPair(token: string, relay?: string, tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") {
    return `bunx ${spec} install --pair ${token}${relayArg(relay)}`
  }
  return `npx --yes --prefix . --package=${spec} ${bin} install --pair ${token}${relayArg(relay)}`
}

export function pairPush(token: string, relay?: string, tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx") {
    return `bunx ${spec} pair --pair ${token}${relayArg(relay)}`
  }
  return `npx --yes --prefix . --package=${spec} ${bin} pair --pair ${token}${relayArg(relay)}`
}

export const PushPlugin = {
  pkg,
  spec,
  bin,
}
