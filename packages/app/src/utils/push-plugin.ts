const pkg = "@whisperopencode/push"
const bin = "opencode-push"

function relayArg(relay?: string) {
  return relay ? ` --relay ${relay}` : ""
}

function spec() {
  return import.meta.env.VITE_WHISPEROPENCODE_PUSH_SPEC || pkg
}

function plugin() {
  return import.meta.env.VITE_WHISPEROPENCODE_PUSH_PLUGIN || spec()
}

function local(value: string) {
  return (
    value.startsWith("/") ||
    value.startsWith("./") ||
    value.startsWith("../") ||
    value.startsWith("file://")
  )
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
  return (list ?? []).some((item) => item === plugin() || name(item) === pkg)
}

export function hasPushSpec(list?: string[]) {
  return (list ?? []).some((item) => item === plugin())
}

export function addPush(list?: string[]) {
  const next = (list ?? []).filter((item) => item !== plugin() && name(item) !== pkg)
  next.push(plugin())
  return next
}

export function dropPush(list?: string[]) {
  return (list ?? []).filter((item) => item !== plugin() && name(item) !== pkg)
}

export function installPush(tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx" && !local(spec())) {
    return `bunx ${spec()} install`
  }
  return `npx --yes --prefix . --package=${spec()} ${bin} install`
}

export function pairPush(token: string, relay?: string, tool: "npx" | "bunx" = "npx") {
  if (tool === "bunx" && !local(spec())) {
    return `bunx ${spec()} pair --pair ${token}${relayArg(relay)}`
  }
  return `npx --yes --prefix . --package=${spec()} ${bin} pair --pair ${token}${relayArg(relay)}`
}

export const PushPlugin = {
  pkg,
  get spec() {
    return spec()
  },
  get plugin() {
    return plugin()
  },
  local,
  bin,
}
