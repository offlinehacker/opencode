const pkg = "@whispercode/opencode-push"
const spec = `${pkg}@0.x`
const cmd = `bunx ${pkg} install`

export function installPrompt(value = cmd) {
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

export function installPush() {
  return cmd
}

export const PushPlugin = {
  pkg,
  spec,
}
