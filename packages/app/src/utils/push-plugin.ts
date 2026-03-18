const pkg = "@whisperopencode/push"
const ver = "0.2.0"
const spec = `${pkg}@${ver}`
const bin = "opencode-push"
const npm = `npx --yes --prefix . --package=${spec} ${bin} install`
const bun = `bunx ${spec} install`

export function installPrompt(value = npm) {
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

export function addPush(list?: string[]) {
  const next = (list ?? []).filter((item) => name(item) !== pkg)
  next.push(spec)
  return next
}

export function dropPush(list?: string[]) {
  return (list ?? []).filter((item) => name(item) !== pkg)
}

export function installPush(tool: "npx" | "bunx" = "npx") {
  return tool === "bunx" ? bun : npm
}

export const PushPlugin = {
  pkg,
  ver,
  spec,
  bin,
}
