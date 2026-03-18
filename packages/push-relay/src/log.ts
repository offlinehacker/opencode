type Level = "info" | "warn" | "error"

export function log(level: Level, msg: string, data?: Record<string, unknown>) {
  const entry = { ts: new Date().toISOString(), level, msg, ...data }
  if (level === "error") console.error(JSON.stringify(entry))
  else console.log(JSON.stringify(entry))
}
