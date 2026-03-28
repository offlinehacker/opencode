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

function name(value: string) {
  const idx = value.lastIndexOf("@")
  if (idx > 0) return value.slice(0, idx)
  return value
}

export function hasPush(list?: string[]) {
  return (list ?? []).some((item) => name(item) === pkg)
}

export function hasPushSpec(list?: string[]) {
  return hasPush(list)
}

export function addPush(list?: string[]) {
  const next = (list ?? []).filter((item) => name(item) !== pkg)
  next.push(spec)
  return next
}

export function dropPush(list?: string[]) {
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
