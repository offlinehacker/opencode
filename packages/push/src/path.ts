import os from "os"
import path from "path"

const app = "opencode"

function home() {
  return process.env.OPENCODE_TEST_HOME || os.homedir()
}

function xdg(key: string, next: string) {
  const root = process.env[key]
  if (root) return path.join(root, app)
  return path.join(home(), ".local", next, app)
}

export function cfgDir() {
  const root = process.env.XDG_CONFIG_HOME
  if (root) return path.join(root, app)
  return path.join(home(), ".config", app)
}

export function stateDir() {
  return xdg("XDG_STATE_HOME", path.join("state"))
}

export function stateFile() {
  return path.join(stateDir(), "whisperopencode-push.json")
}

export function logFile() {
  return path.join(stateDir(), "whisperopencode-push.ndjson")
}
