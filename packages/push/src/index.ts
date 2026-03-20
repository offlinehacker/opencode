import type { Plugin } from "@opencode-ai/plugin"
import { record } from "./event.js"
import { checkin, publish } from "./relay.js"
import { load, save } from "./state.js"

const plugin: Plugin = async () => {
  const boot = load()
    .then(async (data) => {
      if (data.mode !== "relay" || !data.relay) return
      const relay = data.relay
      await checkin(data)
        .then(() => {
          data.relay = {
            ...relay,
            checked: Date.now(),
            result: "ok",
            reason: undefined,
            err: undefined,
          }
          // console.info("whisperopencode-push: channel active")
        })
        .catch((err: unknown) => {
          data.relay = {
            ...relay,
            checked: Date.now(),
            result: "failed",
            err: err instanceof Error ? err.message : String(err),
          }
          // console.warn("whisperopencode-push: checkin failed", data.relay.err)
        })
      await save(data)
    })
    .catch(() => {
      // console.error("whisperopencode-push: init failed")
    })

  let run = Promise.resolve()

  return {
    event({ event }) {
      run = run
        .then(async () => {
          await boot
          const data = await load()
          const item = await record(data, event as never)
          if (item && data.mode === "relay" && data.relay) {
            const relay = data.relay
            await publish(data, item)
              .then((res) => {
                data.relay = {
                  ...relay,
                  checked: Date.now(),
                  result: res.suppressed ? "suppressed" : "accepted",
                  reason: res.reason,
                  delivery: res.deliveries?.[0]?.delivery_id,
                  err: undefined,
                }
                // console.info(
                //   `whisperopencode-push: publish ${res.suppressed ? "suppressed" : "accepted"}`,
                //   res.reason ?? (res.device_count ? `${res.device_count} device(s)` : ""),
                // )
              })
              .catch((err: unknown) => {
                data.relay = {
                  ...relay,
                  checked: Date.now(),
                  result: "failed",
                  err: err instanceof Error ? err.message : String(err),
                }
                // console.warn("whisperopencode-push: publish failed", data.relay.err)
              })
          }
          await save(data)
        })
        .catch(() => {
          // console.error("whisperopencode-push: event failed")
        })
      return run
    },
  }
}

export default plugin
