export const DEFAULT_PUSH_RELAY_URL = "https://whisper.clankercontext.com"

export function normalizePushRelayURL(input?: string) {
  const value = input?.trim()
  if (!value) return
  const next = /^https?:\/\//.test(value) ? value : `http://${value}`
  try {
    const url = new URL(next)
    url.pathname = ""
    url.search = ""
    url.hash = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return
  }
}
