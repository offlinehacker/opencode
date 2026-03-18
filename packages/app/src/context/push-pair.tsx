import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { type PairInfo, type PairState, usePlatform } from "@/context/platform"
import { usePushRelay } from "@/context/push-relay"
import { useServer } from "@/context/server"
import { claimPush } from "@/utils/push-pair"
import { Persist, persisted } from "@/utils/persist"

const WAIT_MS = 15_000
const WAIT_GAP = 500
const RETRY_MS = 15_000

type Step = "permission" | "register" | "begin" | "claim" | "finish"

type Pair = {
  id?: string
  status?: PairState
  token?: string
  command?: string
  expires?: string
  channel?: string
  device?: string
  message?: string
  auto: boolean
  updated: number
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function expired(value?: string) {
  if (!value) return false
  const time = Date.parse(value)
  if (Number.isNaN(time)) return false
  return time <= Date.now()
}

export function canPollPair(input: {
  id?: string
  status?: PairState
  expires?: string
  paired: boolean
  show: boolean
}) {
  if (!input.show || input.paired || !input.id) return false
  if (expired(input.expires)) return false
  return input.status === "pending" || input.status === "claimed"
}

export function canReusePair(input: { id?: string; status?: PairState; token?: string; expires?: string }) {
  if (!input.id || !input.token) return false
  if (expired(input.expires)) return false
  return input.status !== "active" && input.status !== "expired"
}

export function canClearPair(input: { paired: boolean; id?: string; status?: PairState }) {
  if (input.paired) return true
  if (input.id) return true
  return input.status === "pending" || input.status === "claimed"
}

export function canAutoPair(input: {
  auto: boolean
  updated: number
  show: boolean
  run: boolean
  clear: boolean
  server: boolean
  relay: boolean
  retry: number
  now: number
  push?: {
    allowed?: boolean
    registered?: boolean
    paired?: boolean
  }
}) {
  if (!input.auto && input.updated !== 0) return false
  if (!input.show || input.run || input.clear) return false
  if (!input.server || !input.relay) return false
  if (!input.push?.allowed || !input.push.registered || input.push.paired) return false
  return input.now - input.retry >= RETRY_MS
}

export function relaySwitched(input: { prev?: string; next?: string }) {
  return input.prev !== undefined && input.prev !== input.next
}

export const { use: usePushPair, provider: PushPairProvider } = createSimpleContext({
  name: "PushPair",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const relay = usePushRelay()
    const server = useServer()
    const [pair, setPair, , ready] = persisted(
      Persist.global("push.pair", ["push.pair.v2", "push.pair.v1"]),
      createStore<Pair>({
        id: undefined,
        status: undefined,
        token: undefined,
        command: undefined,
        expires: undefined,
        channel: undefined,
        device: undefined,
        message: undefined,
        auto: false,
        updated: 0,
      }),
    )
    const [state, setState] = createStore({
      show: typeof document === "undefined" ? true : document.visibilityState === "visible",
      run: false,
      clear: false,
      step: undefined as Step | undefined,
      tick: 0,
      retry: 0,
    })
    let lastRelay: string | undefined

    const bump = () => setState("tick", (value) => value + 1)

    const save = (value?: PairInfo, opts?: { auto?: boolean; updated?: number }) => {
      setPair({
        id: value?.id,
        status: value?.status,
        token: value?.token,
        command: value?.command,
        expires: value?.expires,
        channel: value?.channel,
        device: value?.device,
        message: value?.message,
        auto: opts?.auto ?? pair.auto,
        updated: opts?.updated ?? (value ? Date.now() : 0),
      })
    }

    const fail = (message: string) => {
      setPair({
        message,
        updated: Date.now(),
      })
    }

    const pull = async () => {
      const next = await platform.getPushState?.().catch(() => undefined)
      return next ?? platform.pushState?.()
    }

    const pullPair = async () => {
      return platform.getPushPairing?.().catch(() => undefined)
    }

    const waitPush = async () => {
      const end = Date.now() + WAIT_MS
      for (;;) {
        const value = await pull()
        if (value?.allowed && value.registered) return value
        if (Date.now() >= end) {
          if (!value?.allowed) throw new Error("Enable notifications for WhisperCode to finish pairing")
          throw new Error("WhisperCode is still waiting for Apple push registration")
        }
        await wait(WAIT_GAP)
      }
    }

    const waitPair = async () => {
      const end = Date.now() + WAIT_MS
      for (;;) {
        const value = await pullPair()
        if (value) {
          save(value, { auto: true })
          if (value.status === "active" || value.status === "expired" || value.status === "failed") {
            if (value.status === "active") {
              await platform.getPushState?.().catch(() => undefined)
            }
            return value
          }
        }
        if (Date.now() >= end) return value
        await wait(WAIT_GAP)
      }
    }

    const setup = async (opts?: { ask?: boolean; quiet?: boolean }) => {
      if (state.run || state.clear) return false
      if (!platform.beginPushPairing || !platform.getPushState || !platform.getPushPairing) {
        throw new Error("Push pairing is unavailable on this device")
      }

      setState("run", true)
      setState("step", undefined)
      if (!opts?.quiet) setPair("auto", true)

      try {
        let push = await pull()

        if (!push?.allowed) {
          if (push?.permission === "denied") {
            if (opts?.ask && platform.openSystemSettings) {
              await platform.openSystemSettings()
              return false
            }
            throw new Error("Enable notifications for WhisperCode in iPhone Settings")
          }

          if (!opts?.ask || !platform.requestPushPermission) {
            throw new Error("Enable notifications for WhisperCode to finish pairing")
          }

          setState("step", "permission")
          push = await platform.requestPushPermission()

          if (!push.allowed) {
            if (push.permission === "denied" && platform.openSystemSettings) {
              await platform.openSystemSettings()
              return false
            }
            throw new Error("Enable notifications for WhisperCode to finish pairing")
          }
        }

        if (!push.registered) {
          setState("step", "register")
          push = await waitPush()
        }

        if (!server.current) {
          throw new Error("Connect to an OpenCode server first")
        }

        let info: PairInfo | undefined = canReusePair(pair)
          ? {
              id: pair.id ?? "pending",
              status: pair.status ?? "pending",
              token: pair.token,
              command: pair.command,
              expires: pair.expires,
              channel: pair.channel,
              device: pair.device,
              message: pair.message,
            }
          : undefined

        if (!info) {
          setState("step", "begin")
          info = await platform.beginPushPairing()
          save(info, { auto: true })
        }

        if (!info.token) {
          const next = await pullPair()
          if (next) {
            info = next
            save(next, { auto: true })
          }
        }

        if (!info.token) {
          throw new Error("Push pairing token unavailable")
        }
        const token = info.token

        setState("step", "claim")
        await claimPush({
          platform,
          server: server.current,
          token,
          relay: relay.current(),
          pairId: info.id,
        })

        setState("step", "finish")
        const done = await waitPair()
        await platform.getPushState?.().catch(() => undefined)

        if (platform.pushState?.()?.paired || done?.status === "active") {
          save(
            {
              ...(info ?? {}),
              ...(done ?? {}),
              id: done?.id ?? info?.id ?? "active",
              status: "active",
              token: undefined,
              channel: done?.channel ?? info?.channel,
              device: done?.device ?? info?.device,
              message: undefined,
            },
            { auto: true },
          )
          return true
        }

        if (done?.status === "expired") {
          throw new Error("This pairing request expired before the iPhone finished syncing")
        }
        if (done?.status === "failed") {
          throw new Error(done.message || "The OpenCode host could not finish pairing this iPhone")
        }
        throw new Error("The OpenCode host claimed the pair, but this iPhone has not finished syncing yet")
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        fail(message)
        throw new Error(message)
      } finally {
        setState("run", false)
        setState("step", undefined)
      }
    }

    const start = async () => {
      if (!platform.beginPushPairing || state.run) return
      setState("run", true)
      setState("step", "begin")
      try {
        const value = await platform.beginPushPairing()
        save(value, { auto: pair.auto })
        return value
      } finally {
        setState("run", false)
        setState("step", undefined)
      }
    }

    const clear = async () => {
      if (!platform.clearPushPairing || state.clear) return
      setState("clear", true)
      try {
        const value = await platform.clearPushPairing()
        save(undefined, { auto: false, updated: Date.now() })
        return value
      } finally {
        setState("clear", false)
      }
    }

    onMount(() => {
      const sync = () => {
        setState("show", document.visibilityState === "visible")
        bump()
      }
      const wake = () => bump()
      sync()
      document.addEventListener("visibilitychange", sync)
      window.addEventListener("focus", wake)
      window.addEventListener("online", wake)
      window.addEventListener("opencode:resume", wake)
      onCleanup(() => {
        document.removeEventListener("visibilitychange", sync)
        window.removeEventListener("focus", wake)
        window.removeEventListener("online", wake)
        window.removeEventListener("opencode:resume", wake)
      })
    })

    createEffect(() => {
      const next = relay.current()
      if (!relaySwitched({ prev: lastRelay, next })) {
        lastRelay = next
        return
      }
      lastRelay = next
      save(undefined, { auto: pair.auto, updated: pair.auto ? 0 : pair.updated })
      setState("retry", 0)
      bump()
    })

    createEffect(() => {
      const push = platform.pushState?.()
      if (push?.paired) {
        save(
          {
            id: pair.id ?? "active",
            status: "active",
            channel: push.channel,
            device: pair.device,
          },
          { auto: true },
        )
        return
      }
      if (!push) return
      if (pair.status !== "active") return
      save(undefined, { auto: pair.auto })
    })

    createEffect(() => {
      if (pair.status !== "pending" && pair.status !== "claimed") return
      if (!expired(pair.expires)) return
      setPair({ status: "expired", updated: Date.now() })
    })

    createEffect(() => {
      if (!platform.getPushPairing) return
      if (
        !canPollPair({
          id: pair.id,
          status: pair.status,
          expires: pair.expires,
          paired: platform.pushState?.()?.paired === true,
          show: state.show,
        })
      ) {
        return
      }

      let live = true
      let timer: number | undefined

      const step = async () => {
        if (!live) return
        if (expired(pair.expires)) {
          setPair({ status: "expired", updated: Date.now() })
          return
        }
        await platform
          .getPushPairing?.()
          .then((value) => {
            if (!live || !value) return
            save(value, { auto: pair.auto })
            if (value.status === "active") {
              setPair("auto", true)
              void platform.getPushState?.()
            }
          })
          .catch(() => undefined)
        if (!live) return
        timer = window.setTimeout(() => {
          void step()
        }, 5000)
      }

      void step()
      onCleanup(() => {
        live = false
        if (timer !== undefined) {
          window.clearTimeout(timer)
        }
      })
    })

    createEffect(() => {
      state.tick
      const now = Date.now()
      const push = platform.pushState?.()
      if (
        !canAutoPair({
          auto: pair.auto,
          updated: pair.updated,
          show: state.show,
          run: state.run,
          clear: state.clear,
          server: !!server.current,
          relay: !!relay.current(),
          retry: state.retry,
          now,
          push,
        })
      ) {
        return
      }
      setState("retry", now)
      const fresh = !pair.auto && pair.updated === 0
      void setup({ ask: false, quiet: !fresh }).catch(() => undefined)
    })

    return {
      ready,
      pair,
      auto: () => pair.auto,
      running: () => state.run,
      clearing: () => state.clear,
      step: () => state.step,
      start,
      setup,
      clear,
    }
  },
})
