import { addPluginListener, invoke } from "@tauri-apps/api/core"

const commands = {
  scanNetwork: "scan_network",
  cancelScan: "cancel_scan",
  share: "share",
} as const

const resolve = (method: string) => {
  if (method in commands) return commands[method as keyof typeof commands]
}

export const bridge = {
  available: () => true,
  send: (method: string, params?: unknown) => {
    void bridge.sendAsync(method, params)
  },
  sendAsync: <T = unknown>(method: string, params?: unknown) => {
    const command = resolve(method)
    if (!command) return Promise.resolve(null)
    return invoke<T>(`plugin:mobile-bridge|${command}`, params as Record<string, unknown>)
      .then((value) => value ?? null)
      .catch(() => null)
  },
  on: (type: string, handler: (payload: unknown) => void) => {
    let active = true
    let listener: { unregister: () => Promise<void> } | null = null

    void addPluginListener("mobile-bridge", type, (payload) => {
      if (!active) return
      handler(payload)
    })
      .then((value) => {
        if (active) {
          listener = value
          return
        }
        void value.unregister().catch(() => undefined)
      })
      .catch(() => undefined)

    return () => {
      active = false
      if (!listener) return
      void listener.unregister().catch(() => undefined)
    }
  },
}
