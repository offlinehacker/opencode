// @refresh reload
import { render } from "solid-js/web"
import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import {
  AppBaseProviders,
  AppInterface,
  type PairInfo,
  PlatformProvider,
  ServerConnection,
  type Platform,
  type PushDiag,
  type PushCred,
  type PushPrefs,
  type PushState,
} from "@opencode-ai/app"
import { showToast } from "@opencode-ai/ui/toast"
import { bridge } from "./bridge"
import { createBridgeStorage } from "./ios-storage"
import { VoiceInputOverlay } from "./voice-input"
import { Onboarding } from "./onboarding"
import pkg from "../package.json"

type VoiceState = "prewarming" | "ready" | "recording" | "processing" | "error"
type VoiceStatus = {
  state: VoiceState
  ready: boolean
  message?: string
}
type VoiceStartResult = {
  ok: boolean
  code?: string
  message?: string
}
type VoiceStopResult = {
  text: string
  code?: string
  message?: string
}

type ServerConfig = { url: string; displayName?: string; username?: string; password?: string }

const emptyPush: PushState = {
  supported: false,
  permission: "unsupported",
  allowed: false,
  registered: false,
  paired: false,
  generic: true,
}

const credentialStorage = createBridgeStorage("opencode.settings.dat")

const normalizeServerUrl = (input: string) => {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found")
}

const App = () => {
  const [voice, setVoice] = createSignal<VoiceStatus>({ state: "prewarming", ready: false })
  const [push, setPush] = createSignal<PushState | undefined>()

  const emitTranscription = (text: string, isFinal?: boolean) => {
    if (!text) return
    window.dispatchEvent(new CustomEvent("opencode:transcription", { detail: { text, isFinal } }))
  }

  const emitResume = () => {
    window.dispatchEvent(new Event("opencode:resume"))
  }

  const showVoiceError = (message?: string) => {
    if (!message) return
    showToast({
      title: "Voice input failed",
      description: message,
      variant: "error",
    })
  }

  const normalizeStatus = (value: unknown): VoiceStatus | null => {
    if (!value || typeof value !== "object") return null
    const state = (value as { state?: unknown }).state
    if (
      state !== "prewarming" &&
      state !== "ready" &&
      state !== "recording" &&
      state !== "processing" &&
      state !== "error"
    ) {
      return null
    }
    return {
      state,
      ready: (value as { ready?: unknown }).ready === true,
      message:
        typeof (value as { message?: unknown }).message === "string"
          ? (value as { message: string }).message
          : undefined,
    }
  }

  const normalizePush = (value: unknown): PushState | null => {
    if (!value || typeof value !== "object") return null
    const permission = (value as { permission?: unknown }).permission
    if (
      permission !== "unsupported" &&
      permission !== "not-determined" &&
      permission !== "denied" &&
      permission !== "authorized" &&
      permission !== "provisional" &&
      permission !== "ephemeral"
    ) {
      return null
    }
    return {
      supported: (value as { supported?: unknown }).supported !== false,
      permission,
      allowed: (value as { allowed?: unknown }).allowed === true,
      registered: (value as { registered?: unknown }).registered === true,
      paired: (value as { paired?: unknown }).paired === true,
      generic: (value as { generic?: unknown }).generic !== false,
      channel:
        typeof (value as { channel?: unknown }).channel === "string"
          ? (value as { channel: string }).channel
          : undefined,
      diag: normalizeDiag((value as { diag?: unknown }).diag) ?? undefined,
    }
  }

  const normalizeDiag = (value: unknown): PushDiag | null => {
    if (!value || typeof value !== "object") return null
    const pair = (value as { pairStatus?: unknown }).pairStatus
    return {
      token: (value as { token?: unknown }).token === true,
      relay: typeof (value as { relay?: unknown }).relay === "string" ? (value as { relay: string }).relay : undefined,
      device:
        typeof (value as { device?: unknown }).device === "string" ? (value as { device: string }).device : undefined,
      pairID:
        typeof (value as { pairID?: unknown }).pairID === "string" ? (value as { pairID: string }).pairID : undefined,
      pairStatus:
        pair === "pending" || pair === "claimed" || pair === "active" || pair === "expired" || pair === "failed"
          ? pair
          : undefined,
      pairExpires:
        typeof (value as { pairExpires?: unknown }).pairExpires === "string"
          ? (value as { pairExpires: string }).pairExpires
          : undefined,
      lastError:
        typeof (value as { lastError?: unknown }).lastError === "string"
          ? (value as { lastError: string }).lastError
          : undefined,
    }
  }

  const normalizePair = (value: unknown): PairInfo | null => {
    if (!value || typeof value !== "object") return null
    const status = (value as { status?: unknown }).status
    if (
      status !== "pending" &&
      status !== "claimed" &&
      status !== "active" &&
      status !== "expired" &&
      status !== "failed"
    ) {
      return null
    }
    const id = typeof (value as { id?: unknown }).id === "string" ? (value as { id: string }).id : undefined
    if (!id && status !== "active") return null
    return {
      id: id ?? "active",
      status,
      token: typeof (value as { token?: unknown }).token === "string" ? (value as { token: string }).token : undefined,
      command:
        typeof (value as { command?: unknown }).command === "string"
          ? (value as { command: string }).command
          : undefined,
      expires:
        typeof (value as { expires?: unknown }).expires === "string"
          ? (value as { expires: string }).expires
          : undefined,
      channel:
        typeof (value as { channel?: unknown }).channel === "string"
          ? (value as { channel: string }).channel
          : undefined,
      device:
        typeof (value as { device?: unknown }).device === "string" ? (value as { device: string }).device : undefined,
      message:
        typeof (value as { message?: unknown }).message === "string"
          ? (value as { message: string }).message
          : undefined,
    }
  }

  const refreshVoice = async () => {
    const result = await bridge.sendAsync<VoiceStatus>("isWhisperReady")
    const status = normalizeStatus(result)
    if (!status) return
    setVoice(status)
  }

  const refreshPush = async () => {
    const result = await bridge.sendAsync<PushState>("getPushState")
    const next = normalizePush(result)
    if (!next) return push() ?? emptyPush
    setPush(next)
    return next
  }

  const startVoiceInput = async (): Promise<VoiceStartResult> => {
    const result = await bridge.sendAsync<VoiceStartResult>("startRecording")
    if (result?.ok) {
      setVoice({ state: "recording", ready: false })
      return result
    }
    const message = result?.message ?? "Voice input is unavailable."
    showVoiceError(message)
    await refreshVoice()
    return {
      ok: false,
      code: result?.code ?? "voice_start_failed",
      message,
    }
  }

  const stopVoiceInput = async (): Promise<VoiceStopResult> => {
    setVoice((value) => (value.state === "recording" ? { ...value, state: "processing", ready: false } : value))
    const result = await bridge.sendAsync<VoiceStopResult>("stopRecording")
    if (!result) {
      const message = "Voice input is unavailable."
      showVoiceError(message)
      await refreshVoice()
      return {
        text: "",
        code: "voice_stop_failed",
        message,
      }
    }
    if (result.code) {
      showVoiceError(result.message ?? "Voice transcription failed.")
      await refreshVoice()
      return result
    }
    await refreshVoice()
    if (result.text) emitTranscription(result.text, true)
    return result
  }

  const platform: Platform = {
    platform: "ios",
    os: "ios",
    version: pkg.version,
    openLink: (url: string) => bridge.send("openLink", { url }),
    notify: async (title, description, href, opts) => {
      await bridge.sendAsync("notify", { title, description, href, opts })
    },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    restart: async () => bridge.send("reload"),
    pushState: push,
    getPushState: async () => refreshPush(),
    requestPushPermission: async () => {
      const result = await bridge.sendAsync<PushState>("requestPushPermission")
      const next = normalizePush(result) ?? push() ?? emptyPush
      setPush(next)
      return next
    },
    beginPushPairing: async () => {
      const result = await bridge.sendAsync<PairInfo>("beginPushPairing", { version: pkg.version })
      const next = normalizePair(result)
      if (!next) throw new Error("Push pairing unavailable")
      return next
    },
    getPushPairing: async () => {
      const result = await bridge.sendAsync<PairInfo>("getPushPairing")
      return normalizePair(result) ?? undefined
    },
    setPushPreferences: async (prefs: PushPrefs) => {
      await bridge.sendAsync("setPushPreferences", prefs)
    },
    setPushRelayURL: async (url?: string) => {
      await bridge.sendAsync("setPushRelayURL", { url })
    },
    openSystemSettings: async () => {
      await bridge.sendAsync("openSystemSettings")
    },
    testPush: async (href?: string) => {
      const result = await bridge.sendAsync<boolean>("testPush", { href })
      return result ?? false
    },
    setPushCredentials: async (input: PushCred) => {
      const result = await bridge.sendAsync<PushState>("setPushCredentials", input)
      const next = normalizePush(result) ?? push() ?? emptyPush
      setPush(next)
      return next
    },
    clearPushPairing: async () => {
      const result = await bridge.sendAsync<PushState>("clearPushPairing")
      const next = normalizePush(result) ?? push() ?? emptyPush
      setPush(next)
      return next
    },
    voiceStatus: voice,
    startVoiceInput,
    stopVoiceInput,
    haptic: (style: "light" | "medium" | "heavy" | "success" | "warning" | "error") => {
      bridge.send("haptic", { style })
    },
    share: async (data: { text?: string; url?: string }) => {
      const result = await bridge.sendAsync<boolean>("share", data)
      return result ?? false
    },
    getDefaultServerUrl: async () => {
      const result = await bridge.sendAsync<string | null>("getDefaultServerUrl")
      return result ?? null
    },
    setDefaultServerUrl: async (url: string | null) => {
      await bridge.sendAsync("setDefaultServerUrl", { url })
    },
    storage: (name?: string) => createBridgeStorage(name),
  }

  const [defaultConfig] = createResource(async () => {
    if (!platform.getDefaultServerUrl) return null
    const url = await Promise.resolve(platform.getDefaultServerUrl?.()).catch(() => null)
    if (!url) return null
    const displayName = await credentialStorage.getItem("displayName").catch(() => null)
    const username = await credentialStorage.getItem("username").catch(() => null)
    const password = await credentialStorage.getItem("password").catch(() => null)
    return {
      url,
      displayName: displayName || undefined,
      username: username || undefined,
      password: password || undefined,
    } as ServerConfig
  })

  const [completedConfig, setCompletedConfig] = createSignal<ServerConfig | null>(null)

  const handleOnboardingComplete = async (server: {
    url: string
    displayName?: string
    username?: string
    password?: string
  }) => {
    const normalized = normalizeServerUrl(server.url)
    if (!normalized) return
    await platform.setDefaultServerUrl?.(normalized)
    if (server.displayName) await credentialStorage.setItem("displayName", server.displayName)
    else await credentialStorage.removeItem("displayName")
    if (server.username) await credentialStorage.setItem("username", server.username)
    else await credentialStorage.removeItem("username")
    if (server.password) await credentialStorage.setItem("password", server.password)
    else await credentialStorage.removeItem("password")
    setCompletedConfig({
      url: normalized,
      displayName: server.displayName,
      username: server.username,
      password: server.password,
    })
  }

  onMount(() => {
    document.documentElement.dataset.platform = "ios"
    void refreshVoice()
    void refreshPush()

    const handleClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest("a.external-link") as HTMLAnchorElement | null
      if (!link?.href) return
      event.preventDefault()
      platform.openLink(link.href)
    }

    const stopListening = bridge.on("transcription", (payload) => {
      if (!payload || typeof payload !== "object") return
      const detail = payload as { text?: string; isFinal?: boolean }
      if (typeof detail.text !== "string") return
      emitTranscription(detail.text, detail.isFinal)
    })

    const stopVoiceState = bridge.on("voiceState", (payload) => {
      const status = normalizeStatus(payload)
      if (!status) return
      setVoice(status)
      if (status.state === "error") showVoiceError(status.message)
    })

    const stopLifecycle = bridge.on("appLifecycle", (payload) => {
      const state =
        typeof payload === "string"
          ? payload
          : typeof payload === "object" && payload
            ? (payload as { state?: unknown }).state
            : undefined
      if (state !== "active") return
      emitResume()
    })

    const stopPushState = bridge.on("pushStateChanged", (payload) => {
      const next = normalizePush(payload)
      if (!next) return
      setPush(next)
    })

    const stopKeyboardNav = bridge.on("keyboardNavigation", (payload) => {
      if (!payload || typeof payload !== "object") return
      const { direction } = payload as { direction?: string }
      if (direction !== "up" && direction !== "down") return
      const key = direction === "up" ? "ArrowUp" : "ArrowDown"
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
    })

    const stopKeyboardClear = bridge.on("keyboardClear", () => {
      const el = document.activeElement
      if (!el || !(el instanceof HTMLElement) || !el.isContentEditable) return
      el.focus()
      document.execCommand("selectAll")
      document.execCommand("delete")
    })

    const stopKeyboardNewline = bridge.on("keyboardNewline", () => {
      const el = document.activeElement
      if (!el || !(el instanceof HTMLElement) || !el.isContentEditable) return
      document.execCommand("insertLineBreak")
    })

    document.addEventListener("click", handleClick)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
      stopListening()
      stopVoiceState()
      stopLifecycle()
      stopPushState()
      stopKeyboardNav()
      stopKeyboardClear()
      stopKeyboardNewline()
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <VoiceInputOverlay
          state={() => {
            const state = voice().state
            if (state === "recording" || state === "processing") return state
            return "hidden"
          }}
          onStop={() => void stopVoiceInput()}
        />
        <Show when={!defaultConfig.loading}>
          <Show
            when={defaultConfig() || completedConfig()}
            fallback={<Onboarding onComplete={handleOnboardingComplete} />}
          >
            <AppInterface
              {...(() => {
                const config = (defaultConfig() || completedConfig())!
                const conn: ServerConnection.Http = {
                  type: "http",
                  displayName: config.displayName,
                  http: {
                    url: config.url,
                    username: config.username,
                    password: config.password,
                  },
                }
                return { defaultServer: ServerConnection.key(conn), servers: [conn] }
              })()}
            />
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

if (root instanceof HTMLElement) {
  render(() => <App />, root)
}
