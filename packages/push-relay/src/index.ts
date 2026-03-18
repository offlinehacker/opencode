import { log } from "./log"
import { listen } from "./server"

const srv = listen({
  port: Number(process.env.PORT || 8787),
  url: process.env.WHISPEROPENCODE_PUSH_RELAY_URL,
  file: process.env.WHISPEROPENCODE_PUSH_RELAY_DB,
})

log("info", "listening", { port: srv.port })

process.on("SIGINT", () => {
  void srv.stop().finally(() => process.exit(0))
})

process.on("SIGTERM", () => {
  void srv.stop().finally(() => process.exit(0))
})
