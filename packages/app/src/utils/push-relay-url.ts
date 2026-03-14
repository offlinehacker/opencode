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

export function guessPushRelayURL(input?: string, port = 8787) {
  const next = normalizePushRelayURL(input)
  if (!next) return
  try {
    const url = new URL(next)
    url.port = String(port)
    return url.toString().replace(/\/+$/, "")
  } catch {
    return
  }
}
