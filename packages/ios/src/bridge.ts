type BridgeRequest = {
  id: string
  method: string
  params?: unknown
}

type Pending = {
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  stop?: () => void
}

type EventHandler = (payload: unknown) => void
type BridgeAPI = {
  onResponse: (id: string, result?: unknown, error?: string) => void
  onEvent: (type: string, payload?: unknown) => void
}
export type BridgeRoot = {
  webkit?: {
    messageHandlers?: {
      opencode?: {
        postMessage: (message: BridgeRequest) => void
      }
    }
  }
  __OPENCODE_BRIDGE__?: BridgeAPI
}

type SendOpts = {
  signal?: AbortSignal
}

const aborted = (sig?: AbortSignal) => {
  if (sig?.reason !== undefined) return sig.reason
  if (typeof DOMException !== "undefined") return new DOMException("Aborted", "AbortError")
  const err = new Error("Aborted")
  err.name = "AbortError"
  return err
}

export const createBridge = (root: BridgeRoot | undefined = typeof window === "undefined" ? undefined : window) => {
  const pending = new Map<string, Pending>()
  const listeners = new Map<string, Set<EventHandler>>()
  let counter = 0

  const nextID = () => `bridge:${Date.now()}:${counter++}`

  const post = (message: BridgeRequest) => {
    const handler = root?.webkit?.messageHandlers?.opencode
    if (!handler?.postMessage) return false
    handler.postMessage(message)
    return true
  }

  const emit = (type: string, payload: unknown) => {
    const set = listeners.get(type)
    if (!set) return
    for (const handler of set) handler(payload)
  }

  const pull = (id: string) => {
    const entry = pending.get(id)
    if (!entry) return
    pending.delete(id)
    entry.stop?.()
    return entry
  }

  const fail = (id: string, error: unknown) => {
    const entry = pull(id)
    if (!entry) return
    entry.reject(error)
  }

  const onResponse = (id: string, result?: unknown, error?: string) => {
    const entry = pull(id)
    if (!entry) return
    if (error) return entry.reject(new Error(error))
    entry.resolve(result)
  }

  const onEvent = (type: string, payload?: unknown) => {
    emit(type, payload)
  }

  if (root) {
    root.__OPENCODE_BRIDGE__ = {
      onResponse,
      onEvent,
    }
  }

  return {
    available: () => !!root?.webkit?.messageHandlers?.opencode?.postMessage,
    send: (method: string, params?: unknown) => {
      const id = nextID()
      post({ id, method, params })
    },
    sendAsync: <T = unknown>(method: string, params?: unknown, opts?: SendOpts) => {
      const id = nextID()
      const sig = opts?.signal
      return new Promise<T | null>((resolve, reject) => {
        if (sig?.aborted) {
          reject(aborted(sig))
          return
        }
        const entry: Pending = {
          resolve: (value) => resolve(value as T | null),
          reject,
        }
        if (sig) {
          const stop = () => fail(id, aborted(sig))
          sig.addEventListener("abort", stop, { once: true })
          entry.stop = () => sig.removeEventListener("abort", stop)
        }
        pending.set(id, entry)
        try {
          if (post({ id, method, params })) return
        } catch (error) {
          fail(id, error)
          return
        }
        pull(id)?.resolve(null)
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
    debug: {
      pending: () => pending.size,
    },
  }
}

export const bridge = createBridge()

declare global {
  interface Window {
    webkit?: BridgeRoot["webkit"]
    __OPENCODE_BRIDGE__?: BridgeAPI
  }
}
