export type PushOpen = {
  href?: string
  channel?: string
  session?: string
  kind?: string
}

let nav: ((href: string) => void) | undefined
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
  if (!value.channel && !value.session && !value.kind && value.href) {
    return openHref(value.href)
  }
  if (open) return open(value)
  pending = value
}
