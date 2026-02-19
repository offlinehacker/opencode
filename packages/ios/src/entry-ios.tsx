// @refresh reload
import { render } from "solid-js/web"
import { createResource, createSignal, onCleanup, onMount } from "solid-js"
import { AppBaseProviders, AppInterface, PlatformProvider, type Platform } from "@opencode-ai/app"
import { bridge } from "./bridge"
import { createBridgeStorage } from "./ios-storage"
import { VoiceInputOverlay } from "./voice-input"
import pkg from "../package.json"

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found")
}

const App = () => {
  const [recording, setRecording] = createSignal(false)

  const emitTranscription = (text: string, isFinal?: boolean) => {
    if (!text) return
    window.dispatchEvent(new CustomEvent("opencode:transcription", { detail: { text, isFinal } }))
  }

  const startVoiceInput = () => {
    setRecording(true)
    bridge.send("startRecording")
  }

  const stopVoiceInput = async () => {
    const text = await bridge.sendAsync<string>("stopRecording")
    setRecording(false)
    if (text) emitTranscription(text, true)
    return text ?? ""
  }

  const platform: Platform = {
    platform: "ios",
    os: "ios",
    version: pkg.version,
    openLink: (url: string) => bridge.send("openLink", { url }),
    notify: async (title: string, description?: string, href?: string) => {
      await bridge.sendAsync("notify", { title, description, href })
    },
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    restart: async () => window.location.reload(),
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

  const [defaultUrl] = createResource(async () => {
    if (!platform.getDefaultServerUrl) return null
    const result = await Promise.resolve(platform.getDefaultServerUrl?.()).catch(() => null)
    return result ?? null
  })

  onMount(() => {
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
      stopKeyboardNav()
      stopKeyboardClear()
      stopKeyboardNewline()
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <VoiceInputOverlay active={recording} onStop={() => void stopVoiceInput()} />
        <AppInterface defaultUrl={defaultUrl() ?? undefined} />
      </AppBaseProviders>
    </PlatformProvider>
  )
}

if (root instanceof HTMLElement) {
  render(() => <App />, root)
}
