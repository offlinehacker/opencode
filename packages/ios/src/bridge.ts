type BridgeRequest = {
  id: string
  method: string
  params?: unknown
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
}

type EventHandler = (payload: unknown) => void

const pending = new Map<string, Pending>()
const listeners = new Map<string, Set<EventHandler>>()
let counter = 0

const nextID = () => `bridge:${Date.now()}:${counter++}`

const post = (message: BridgeRequest) => {
  if (typeof window === "undefined") return false
  const handler = window.webkit?.messageHandlers?.opencode
  if (!handler?.postMessage) return false
  handler.postMessage(message)
  return true
}

const emit = (type: string, payload: unknown) => {
  const set = listeners.get(type)
  if (!set) return
  for (const handler of set) handler(payload)
}

const onResponse = (id: string, result?: unknown, error?: string) => {
  const entry = pending.get(id)
  if (!entry) return
  pending.delete(id)
  if (error) return entry.reject(new Error(error))
  entry.resolve(result)
}

const onEvent = (type: string, payload?: unknown) => {
  emit(type, payload)
}

if (typeof window !== "undefined") {
  window.__OPENCODE_BRIDGE__ = {
    onResponse,
    onEvent,
  }
}

export const bridge = {
  available: () => typeof window !== "undefined" && !!window.webkit?.messageHandlers?.opencode?.postMessage,
  send: (method: string, params?: unknown) => {
    const id = nextID()
    post({ id, method, params })
  },
  sendAsync: <T = unknown>(method: string, params?: unknown) => {
    const id = nextID()
    return new Promise<T | null>((resolve, reject) => {
      const entry: Pending = {
        resolve: (value) => resolve(value as T | null),
        reject,
      }
      pending.set(id, entry)
      if (post({ id, method, params })) return
      pending.delete(id)
      resolve(null)
    })
  },
  on: (type: string, handler: EventHandler) => {
    const set = listeners.get(type) ?? new Set<EventHandler>()
    set.add(handler)
    listeners.set(type, set)
    return () => {
      const next = listeners.get(type)
      if (!next) return
      next.delete(handler)
      if (next.size === 0) listeners.delete(type)
    }
  },
}

declare global {
  interface Window {
    webkit?: {
      messageHandlers?: {
        opencode?: {
          postMessage: (message: BridgeRequest) => void
        }
      }
    }
    __OPENCODE_BRIDGE__?: {
      onResponse: (id: string, result?: unknown, error?: string) => void
      onEvent: (type: string, payload?: unknown) => void
    }
  }
}
