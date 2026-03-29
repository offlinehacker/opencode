// UPSTREAM-DIVERGENCE-FILE: Notification click handling was widened after upstream sync 6b9ce5e63 so
// fork mobile builds can reopen server/session context from generic push payloads instead of href-only
// desktop/web notifications.

export type PushOpen = {
  href?: string
  channel?: string
  session?: string
  kind?: string
}

let nav: ((href: string) => void) | undefined
// UPSTREAM-DIVERGENCE: Layout installs this callback to resolve channel-aware push taps after router,
// server, and session state are available.
let open: ((value: PushOpen) => void) | undefined
let pending: PushOpen | undefined

export const setNavigate = (fn: (href: string) => void) => {
  nav = fn
}

export const setNotificationOpen = (fn?: (value: PushOpen) => void) => {
  open = fn
  if (!fn || !pending) return
  const next = pending
  pending = undefined
  fn(next)
}

export const stashNotificationOpen = (value: PushOpen) => {
  pending = value
}

const openHref = (href: string) => {
  if (nav) return nav(href)
  console.warn("notification-click: navigate function not set, falling back to window.location.assign")
  window.location.assign(href)
}

export const handleNotificationClick = (value?: string | PushOpen) => {
  window.focus()
  if (!value) return
  if (typeof value === "string") return openHref(value)
  // UPSTREAM-DIVERGENCE: Preserve the object payload path for mobile wrappers. Generic push payloads
  // may carry channel/session metadata even when no final href is known at delivery time.
  if (!value.channel && !value.session && !value.kind && value.href) {
    return openHref(value.href)
  }
  if (open) return open(value)
  pending = value
}
