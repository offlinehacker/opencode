// @refresh reload
import { render } from "solid-js/web"
import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { AppBaseProviders, AppInterface, PlatformProvider, ServerConnection, type Platform } from "@opencode-ai/app"
import { impactFeedback, notificationFeedback } from "@tauri-apps/plugin-haptics"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Store } from "@tauri-apps/plugin-store"
import { bridge } from "./bridge"
import { createTauriStorage } from "./storage"
import { Onboarding } from "./onboarding"
import pkg from "../package.json"

const SETTINGS_STORE = "opencode.settings.dat"
const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
const DEFAULT_SERVER_USERNAME_KEY = "defaultServerUsername"
const DEFAULT_SERVER_PASSWORD_KEY = "defaultServerPassword"
const DEFAULT_SERVER_DISPLAY_NAME_KEY = "defaultServerDisplayName"
const settingsStore = Store.load(SETTINGS_STORE)

type ServerConfig = { url: string; displayName?: string; username?: string; password?: string }

const normalizeServerUrl = (input: string) => {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

const getDefaultServerConfig = async (): Promise<ServerConfig | null> => {
  const store = await settingsStore
  const url = await store.get(DEFAULT_SERVER_URL_KEY).catch(() => null)
  if (typeof url !== "string") return null
  const displayName = await store.get(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => null)
  const username = await store.get(DEFAULT_SERVER_USERNAME_KEY).catch(() => null)
  const password = await store.get(DEFAULT_SERVER_PASSWORD_KEY).catch(() => null)
  return {
    url,
    displayName: typeof displayName === "string" ? displayName : undefined,
    username: typeof username === "string" ? username : undefined,
    password: typeof password === "string" ? password : undefined,
  }
}

const setDefaultServerConfig = async (config: ServerConfig | null) => {
  const store = await settingsStore
  if (config) {
    await store.set(DEFAULT_SERVER_URL_KEY, config.url).catch(() => undefined)
    if (config.displayName) await store.set(DEFAULT_SERVER_DISPLAY_NAME_KEY, config.displayName).catch(() => undefined)
    else await store.delete(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => undefined)
    if (config.username) await store.set(DEFAULT_SERVER_USERNAME_KEY, config.username).catch(() => undefined)
    else await store.delete(DEFAULT_SERVER_USERNAME_KEY).catch(() => undefined)
    if (config.password) await store.set(DEFAULT_SERVER_PASSWORD_KEY, config.password).catch(() => undefined)
    else await store.delete(DEFAULT_SERVER_PASSWORD_KEY).catch(() => undefined)
  } else {
    await store.delete(DEFAULT_SERVER_URL_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_USERNAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_PASSWORD_KEY).catch(() => undefined)
  }
  await store.save().catch(() => undefined)
}

const getDefaultServerUrl = async (): Promise<ServerConnection.Key | null> => {
  const config = await getDefaultServerConfig()
  return (config?.url ?? null) as ServerConnection.Key | null
}

const setDefaultServerUrl = async (url: ServerConnection.Key | null) => {
  if (url) {
    await setDefaultServerConfig({ url })
  } else {
    await setDefaultServerConfig(null)
  }
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found")
}

const App = () => {
  const emitResume = () => {
    window.dispatchEvent(new Event("opencode:resume"))
  }

  const platform: Platform = {
    platform: "mobile",
    os: "android",
    connectionHelpUrl: "https://opencode.ai/docs/web/",
    version: pkg.version,
    openLink: (url: string) => {
      void openUrl(url).catch(() => undefined)
    },
    notify: async (title: string, description?: string, href?: string, opts?: unknown) => {
      void href
      void opts
      const granted = await isPermissionGranted().catch(() => false)
      const permission = granted ? "granted" : await requestPermission().catch(() => "denied")
      if (permission !== "granted") return
      await Promise.resolve()
        .then(() =>
          sendNotification({
            title,
            body: description ?? "",
          }),
        )
        .catch(() => undefined)
    },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    restart: async () => window.location.reload(),
    haptic: (style: "light" | "medium" | "heavy" | "success" | "warning" | "error") => {
      if (style === "success" || style === "warning" || style === "error") {
        void notificationFeedback(style).catch(() => undefined)
        return
      }
      void impactFeedback(style).catch(() => undefined)
    },
    share: async (data: { text?: string; url?: string }) => {
      const result = await bridge.sendAsync<boolean>("share", data)
      return result ?? false
    },
    getDefaultServer: getDefaultServerUrl,
    setDefaultServer: setDefaultServerUrl,
    storage: (name?: string) => createTauriStorage(name),
  }

  const [defaultConfig] = createResource(async () => {
    const config = await getDefaultServerConfig()
    return config ?? null
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
    const config: ServerConfig = {
      url: normalized,
      displayName: server.displayName,
      username: server.username,
      password: server.password,
    }
    await setDefaultServerConfig(config)
    setCompletedConfig(config)
  }

  onMount(() => {
    document.documentElement.dataset.platform = "android"

    const handleClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest("a.external-link") as HTMLAnchorElement | null
      if (!link?.href) return
      event.preventDefault()
      platform.openLink(link.href)
    }

    const onFocus = () => emitResume()
    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      emitResume()
    }

    document.addEventListener("click", handleClick)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisible)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisible)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
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
