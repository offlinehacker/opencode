import fs from "fs/promises"
import { debugFile, stateDir } from "./path.js"

export async function trace(kind: string, data: Record<string, unknown> = {}) {
  const file = debugFile()
  const line =
    JSON.stringify({
      at: Date.now(),
      pid: process.pid,
      kind,
      ...data,
    }) + "\n"

  await fs.mkdir(stateDir(), { recursive: true }).catch(() => undefined)
  await fs.appendFile(file, line, "utf8").catch(() => undefined)
  await fs.chmod(file, 0o600).catch(() => undefined)
}
