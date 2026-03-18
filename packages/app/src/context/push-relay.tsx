import { createSimpleContext } from "@opencode-ai/ui/context"
import { createEffect, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { usePlatform } from "@/context/platform"
import { Persist, persisted } from "@/utils/persist"
import { DEFAULT_PUSH_RELAY_URL, normalizePushRelayURL } from "@/utils/push-relay-url"

export const { use: usePushRelay, provider: PushRelayProvider } = createSimpleContext({
  name: "PushRelay",
  init: () => {
    const platform = usePlatform()

    const [store, setStore, , ready] = persisted(
      Persist.global("push.relay", ["push.relay.v1"]),
      createStore({
        url: undefined as string | undefined,
      }),
    )

    const current = createMemo(() => store.url ?? DEFAULT_PUSH_RELAY_URL)
    let last: string | undefined

    createEffect(() => {
      const next = current()
      if (!platform.setPushRelayURL || next === last) return
      last = next
      void platform.setPushRelayURL(next)
    })

    return {
      ready,
      current,
      custom: () => store.url,
      set(value?: string) {
        setStore("url", normalizePushRelayURL(value))
      },
      clear() {
        setStore("url", undefined)
      },
    }
  },
})
