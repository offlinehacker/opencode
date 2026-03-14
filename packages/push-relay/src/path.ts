import os from "os"
import path from "path"

const app = "opencode"

function home() {
  return process.env.OPENCODE_TEST_HOME || os.homedir()
}

export function dir() {
  const root = process.env.WHISPERCODE_PUSH_RELAY_STATE_DIR || process.env.XDG_STATE_HOME
  if (root) return path.join(root, app)
  return path.join(home(), ".local", "state", app)
}

export function file() {
  return process.env.WHISPERCODE_PUSH_RELAY_DB || path.join(dir(), "whispercode-push-relay.sqlite")
}
