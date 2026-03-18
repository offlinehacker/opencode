import { createEffect, createSignal, For, onCleanup, Show } from "solid-js"
import { Button } from "@opencode-ai/ui/button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Icon } from "@opencode-ai/ui/icon"
import { Logo } from "@opencode-ai/ui/logo"
import { bridge } from "./bridge"

interface OnboardingProps {
  onComplete: (server: { url: string; displayName?: string; username?: string; password?: string }) => void
}

type ScanResult = { host: string; port: number; url: string }

async function checkHealth(url: string, username?: string, password?: string): Promise<boolean> {
  const base = url.replace(/\/+$/, "")
  const headers: HeadersInit = {}
  if (password) {
    headers["Authorization"] = `Basic ${btoa(`${username || "opencode"}:${password}`)}`
  }
  const primary = await fetch(`${base}/global/health`, { headers, signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false)
  if (primary) return true
  return fetch(`${base}/health`, { headers, signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false)
}

function CopyBlock(props: { code: string }) {
  const [copied, setCopied] = createSignal(false)

  const copy = () => {
    navigator.clipboard
      .writeText(props.code)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <div class="relative group">
      <pre class="bg-surface-raised-base text-text-secondary-base text-14-regular px-4 py-3 rounded-md overflow-x-auto">
        <code>{props.code}</code>
      </pre>
      <button
        type="button"
        class="absolute top-2 right-2 p-1.5 rounded-sm bg-surface-base hover:bg-surface-base-hover transition-colors"
        onClick={copy}
      >
        <Icon name={copied() ? "check" : "copy"} size="small" />
      </button>
    </div>
  )
}

export function Onboarding(props: OnboardingProps) {
  const [step, setStep] = createSignal(0)
  const [scanning, setScanning] = createSignal(false)
  const [servers, setServers] = createSignal<ScanResult[]>([])
  const [selected, setSelected] = createSignal<string | null>(null)
  const [manualUrl, setManualUrl] = createSignal("")
  const [manualName, setManualName] = createSignal("")
  const [manualUsername, setManualUsername] = createSignal("")
  const [manualPassword, setManualPassword] = createSignal("")
  const [manualStatus, setManualStatus] = createSignal<boolean | undefined>(undefined)
  const [selectedHealthy, setSelectedHealthy] = createSignal<boolean | undefined>(undefined)

  let healthTimer: ReturnType<typeof setTimeout> | undefined

  const stopScanResult = bridge.on("scanResult", (payload) => {
    const result = payload as ScanResult
    if (!result?.url) return
    setServers((prev) => {
      if (prev.some((s) => s.url === result.url)) return prev
      return [...prev, result]
    })
  })

  const stopScanComplete = bridge.on("scanComplete", () => {
    setScanning(false)
  })

  onCleanup(() => {
    stopScanResult()
    stopScanComplete()
    if (healthTimer) clearTimeout(healthTimer)
    void bridge.sendAsync("cancelScan")
  })

  const startScan = () => {
    setScanning(true)
    setServers([])
    setSelected(null)
    setSelectedHealthy(undefined)
    void bridge.sendAsync("scanNetwork")
  }

  const selectServer = async (url: string) => {
    setSelected(url)
    setSelectedHealthy(undefined)
    const healthy = await checkHealth(url, manualUsername(), manualPassword())
    if (selected() === url) setSelectedHealthy(healthy)
  }

  createEffect(() => {
    const raw = manualUrl()
    const username = manualUsername()
    const password = manualPassword()
    const url = raw.trim()
    setManualStatus(undefined)
    if (healthTimer) clearTimeout(healthTimer)
    if (!url) return
    healthTimer = setTimeout(async () => {
      const normalized = url.startsWith("http") ? url : `http://${url}`
      const healthy = await checkHealth(normalized, username, password)
      if (manualUrl().trim() === url) setManualStatus(healthy)
    }, 500)
  })

  const connectUrl = () => {
    if (selected() && selectedHealthy()) return selected()!
    const url = manualUrl().trim()
    if (url && manualStatus()) return url.startsWith("http") ? url : `http://${url}`
    return null
  }

  const connect = () => {
    const url = connectUrl()
    if (url) {
      const displayName = manualName().trim() || undefined
      const username = manualUsername().trim() || undefined
      const password = manualPassword().trim() || undefined
      props.onComplete({ url, displayName, username, password })
    }
  }

  return (
    <div class="flex flex-col items-center justify-center min-h-screen px-6 py-12 bg-bg-base">
      <Show when={step() === 0}>
        <div class="flex flex-col items-center text-center max-w-sm w-full gap-6">
          <Logo class="w-32 opacity-80" />
          <div class="flex flex-col gap-2">
            <h1 class="text-2xl font-semibold text-text-strong">Welcome to WhisperCode</h1>
            <p class="text-text-weak text-14-regular leading-relaxed">
              WhisperCode connects to an OpenCode server running on your development machine. We&apos;ll help you get
              set up.
            </p>
          </div>
          <Button variant="primary" size="large" class="w-full mt-4" onClick={() => setStep(1)}>
            Get Started
          </Button>
        </div>
      </Show>

      <Show when={step() === 1}>
        <div class="flex flex-col items-center max-w-sm w-full gap-6">
          <StepIndicator current={1} total={3} />
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-xl font-semibold text-text-strong">Install OpenCode</h2>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Install the OpenCode CLI on your development machine.
            </p>
          </div>
          <a
            href="https://opencode.ai/"
            class="external-link flex items-center justify-center gap-2 w-full px-4 py-3 rounded-md bg-surface-raised-base text-text-strong text-14-regular hover:bg-surface-base-hover transition-colors"
          >
            <span>opencode.ai</span>
            <Icon name="square-arrow-top-right" size="small" />
          </a>
          <div class="flex gap-3 w-full mt-2">
            <Button variant="secondary" size="large" class="flex-1" onClick={() => setStep(0)}>
              Back
            </Button>
            <Button variant="primary" size="large" class="flex-1" onClick={() => setStep(2)}>
              Next
            </Button>
          </div>
        </div>
      </Show>

      <Show when={step() === 2}>
        <div class="flex flex-col items-center max-w-sm w-full gap-6">
          <StepIndicator current={2} total={3} />
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-xl font-semibold text-text-strong">Start the Server</h2>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Run this command in a project directory on your development machine to start the OpenCode server.
            </p>
          </div>
          <CopyBlock code="opencode web --hostname 0.0.0.0" />
          <div class="flex gap-3 w-full mt-2">
            <Button variant="secondary" size="large" class="flex-1" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary" size="large" class="flex-1" onClick={() => setStep(3)}>
              Next
            </Button>
          </div>
        </div>
      </Show>

      <Show when={step() === 3}>
        <div class="flex flex-col items-center max-w-sm w-full gap-5">
          <StepIndicator current={3} total={3} />
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-xl font-semibold text-text-strong">Connect</h2>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Scan your network to find your server, or enter the address manually.
            </p>
          </div>

          <Button
            variant="secondary"
            size="large"
            class="w-full"
            icon="magnifying-glass"
            onClick={startScan}
            disabled={scanning()}
          >
            {scanning() ? "Scanning..." : "Scan Network"}
          </Button>

          <Show when={scanning()}>
            <p class="text-text-dimmed text-12-regular animate-pulse">Scanning your network...</p>
          </Show>

          <Show when={servers().length > 0}>
            <div class="w-full rounded-md bg-surface-raised-base overflow-hidden">
              <For each={servers()}>
                {(server) => {
                  const isSelected = () => selected() === server.url
                  return (
                    <button
                      type="button"
                      class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-base-hover"
                      classList={{ "bg-surface-base-active": isSelected() }}
                      onClick={() => void selectServer(server.url)}
                    >
                      <div
                        classList={{
                          "size-2 rounded-full shrink-0": true,
                          "bg-icon-success-base": isSelected() && selectedHealthy() === true,
                          "bg-icon-critical-base": isSelected() && selectedHealthy() === false,
                          "bg-border-weak-base": !isSelected() || selectedHealthy() === undefined,
                        }}
                      />
                      <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-14-regular text-text-strong truncate">{server.host}</span>
                        <span class="text-12-regular text-text-dimmed truncate">{server.url}</span>
                      </div>
                      <Show when={isSelected()}>
                        <Icon name="check" size="small" class="text-icon-success-base shrink-0" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>

          <div class="w-full flex items-center gap-3">
            <div class="flex-1 h-px bg-border-weak-base" />
            <span class="text-text-dimmed text-12-regular">or enter manually</span>
            <div class="flex-1 h-px bg-border-weak-base" />
          </div>

          <div class="w-full flex items-center gap-2">
            <div
              classList={{
                "size-2 rounded-full shrink-0": true,
                "bg-icon-success-base": manualStatus() === true,
                "bg-icon-critical-base": manualStatus() === false,
                "bg-border-weak-base": manualStatus() === undefined,
              }}
            />
            <div class="flex-1">
              <TextField
                hideLabel
                label="Server URL"
                placeholder="http://192.168.1.100:4096"
                value={manualUrl()}
                onChange={setManualUrl}
              />
            </div>
          </div>

          <div class="w-full">
            <TextField
              hideLabel
              label="Display Name"
              placeholder="My Server"
              value={manualName()}
              onChange={setManualName}
            />
          </div>
          <div class="w-full grid grid-cols-2 gap-2">
            <TextField
              hideLabel
              label="Username"
              placeholder="username"
              value={manualUsername()}
              onChange={setManualUsername}
            />
            <TextField
              hideLabel
              label="Password"
              type="password"
              placeholder="password"
              value={manualPassword()}
              onChange={setManualPassword}
            />
          </div>

          <div class="flex gap-3 w-full mt-2">
            <Button variant="secondary" size="large" class="flex-1" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button variant="primary" size="large" class="flex-1" disabled={!connectUrl()} onClick={connect}>
              Connect
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

function StepIndicator(props: { current: number; total: number }) {
  return (
    <div class="flex items-center gap-2 mb-2">
      {Array.from({ length: props.total }, (_, i) => (
        <div
          classList={{
            "h-1 rounded-full transition-all": true,
            "w-8 bg-icon-strong-base": i + 1 === props.current,
            "w-4 bg-border-weak-base": i + 1 !== props.current,
          }}
        />
      ))}
    </div>
  )
}
