import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, onCleanup, onMount } from "solid-js"
import { createStore } from "solid-js/store"
import { type PairInfo, type PairState, usePlatform } from "@/context/platform"
import { usePushRelay } from "@/context/push-relay"
import { useServer } from "@/context/server"
import { Persist, persisted } from "@/utils/persist"
import { mergePushIssue, PushFail, type PushIssue, type PushPhase, runPushSetup } from "@/utils/push-pair"

const RETRY_MS = 15_000

type Pair = {
  id?: string
  status?: PairState
  token?: string
  command?: string
  expires?: string
  channel?: string
  device?: string
  message?: string
  code?: PushIssue["code"]
  detail?: string
  action?: PushIssue["action"]
  auto: boolean
  updated: number
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

export function canSyncPair(input: { id?: string; status?: PairState; expires?: string; paired: boolean }) {
  if (input.paired) return false
  if (!input.id) return true
  if (input.status === "active") return false
  return !canPollPair({
    id: input.id,
    status: input.status,
    expires: input.expires,
    paired: false,
    show: true,
  })
}

export function canClearPair(input: { paired: boolean; id?: string; status?: PairState }) {
  if (input.paired) return true
  if (input.id) return true
  return input.status === "pending" || input.status === "claimed"
}

export function canAutoPair(input: {
  auto: boolean
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
  if (!input.auto) return false
  if (!input.show || input.run || input.clear) return false
  if (!input.server || !input.relay) return false
  if (!input.push?.allowed || !input.push.registered || input.push.paired) return false
  return input.now - input.retry >= RETRY_MS
}

export function relaySwitched(input: { prev?: string; next?: string }) {
  return input.prev !== undefined && input.prev !== input.next
}

function limited(err: unknown) {
  const next = (err instanceof Error ? err.message : String(err)).trim().toLowerCase()
  return (
    next.includes("rate_limited") ||
    next.includes("rate limited") ||
    next.includes("too many requests") ||
    next.includes("429")
  )
}

export const { use: usePushPair, provider: PushPairProvider } = createSimpleContext({
  name: "PushPair",
  gate: false,
  init: () => {
    const platform = usePlatform()
    const relay = usePushRelay()
    const server = useServer()
    const [pair, setPair, , ready] = persisted(
      Persist.global("push.pair", ["push.pair.v3", "push.pair.v2", "push.pair.v1"]),
      createStore<Pair>({
        id: undefined,
        status: undefined,
        token: undefined,
        command: undefined,
        expires: undefined,
        channel: undefined,
        device: undefined,
        message: undefined,
        code: undefined,
        detail: undefined,
        action: undefined,
        auto: false,
        updated: 0,
      }),
    )
    const [state, setState] = createStore({
      show: typeof document === "undefined" ? true : document.visibilityState === "visible",
      run: false,
      clear: false,
      phase: undefined as PushPhase | undefined,
      tick: 0,
      retry: 0,
      tries: 0,
      source: undefined as "settings" | "auto" | undefined,
      trace: [] as string[],
    })
    let lastRelay: string | undefined

    const bump = () => setState("tick", (value) => value + 1)
    const track = (value: string) => {
      console.debug("[push-flow]", value)
      setState("trace", (list) => [...list, value].slice(-20))
    }

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
        code: undefined,
        detail: undefined,
        action: undefined,
        auto: opts?.auto ?? pair.auto,
        updated: opts?.updated ?? (value ? Date.now() : 0),
      })
    }

    const stop = (next: PushIssue, value?: Partial<PairInfo>) => {
      setPair({
        id: value?.id ?? pair.id,
        status: value?.status ?? pair.status,
        token: value?.token ?? pair.token,
        command: value?.command ?? pair.command,
        expires: value?.expires ?? pair.expires,
        channel: value?.channel ?? pair.channel,
        device: value?.device ?? pair.device,
        message: next.message,
        code: next.code,
        detail: next.detail,
        action: next.action,
        auto: false,
        updated: Date.now(),
      })
    }

    const setup = async (opts?: { ask?: boolean; source?: "settings" | "auto" }) => {
      if (state.run || state.clear) return false

      setState("trace", [])
      setState("run", true)
      setState("phase", undefined)
      setState("tries", (value) => value + 1)
      setState("source", opts?.source ?? "settings")
      track(`setup source=${opts?.source ?? "settings"} ask=${opts?.ask === true ? "1" : "0"}`)

      try {
        const result = await runPushSetup({
          platform,
          server: server.current,
          relay: relay.current(),
          pair,
          ask: opts?.ask,
          onPhase: (value) => setState("phase", value),
          onPair: (value) => save(value, { auto: opts?.source === "auto" ? true : pair.auto }),
          onTrace: track,
        })

        save(result.pair, { auto: true })
        return true
      } catch (err) {
        if (err instanceof PushFail) {
          stop(err.issue)
          throw err
        }
        throw err
      } finally {
        setState("run", false)
        setState("phase", undefined)
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

    const sync = (value: PairInfo, opts?: { auto?: boolean }) => {
      if (value.status === "failed") {
        stop(
          {
            code: "pair_failed",
            message: value.message || "The OpenCode host could not finish pairing this iPhone.",
            action: "retry",
          },
          value,
        )
        return
      }
      if (value.status === "expired") {
        stop(
          {
            code: "pair_expired",
            message: value.message || "This pairing request expired before the iPhone finished syncing.",
            action: "retry",
          },
          value,
        )
        return
      }
      save(value, { auto: opts?.auto ?? pair.auto })
      if (value.status === "active") {
        setPair("auto", true)
        void platform.getPushState?.()
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
      state.tick
      if (!platform.getPushPairing) return
      if (state.run || state.clear) return
      if (
        !canSyncPair({
          id: pair.id,
          status: pair.status,
          expires: pair.expires,
          paired: platform.pushState?.()?.paired === true,
        })
      ) {
        return
      }

      let live = true
      void platform
        .getPushPairing?.()
        .then((value) => {
          if (!live || !value) return
          sync(value, { auto: false })
        })
        .catch(() => undefined)

      onCleanup(() => {
        live = false
      })
    })

    createEffect(() => {
      if (pair.status !== "pending" && pair.status !== "claimed") return
      if (!expired(pair.expires)) return
      stop(
        {
          code: "pair_expired",
          message: "This pairing request expired before the iPhone finished syncing.",
          action: "retry",
        },
        { status: "expired" },
      )
    })

    createEffect(() => {
      if (!platform.getPushPairing) return
      if (state.run || state.clear) return
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
      let halt = false
      let timer: number | undefined

      const step = async () => {
        if (!live || halt) return
        if (expired(pair.expires)) {
          stop(
            {
              code: "pair_expired",
              message: "This pairing request expired before the iPhone finished syncing.",
              action: "retry",
            },
            { status: "expired" },
          )
          return
        }
        await platform
          .getPushPairing?.()
          .then((value) => {
            if (!live || !value) return
            sync(value)
          })
          .catch((err) => {
            if (!live || !limited(err)) return
            halt = true
            stop(
              {
                code: "relay_rate_limited",
                message: "Push relay is temporarily rate limited. Wait a minute and try again.",
                action: "retry",
              },
              { status: "failed" },
            )
          })
        if (!live || halt) return
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
      void setup({ ask: false, source: "auto" }).catch(() => undefined)
    })

    return {
      ready,
      pair,
      issue: () => {
        const next = pair.code
          ? {
              code: pair.code,
              message: pair.message ?? "Notification setup failed.",
              detail: pair.detail,
              action: pair.action ?? "retry",
            }
          : undefined
        return mergePushIssue(next, platform.pushState?.())
      },
      auto: () => pair.auto,
      running: () => state.run,
      clearing: () => state.clear,
      phase: () => state.phase,
      attempt: () => state.tries,
      source: () => state.source,
      trace: () => state.trace,
      setup,
      clear,
    }
  },
})
