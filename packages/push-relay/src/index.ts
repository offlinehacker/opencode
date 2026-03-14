import { listen } from "./server"

const srv = listen({
  port: Number(process.env.PORT || 8787),
  url: process.env.WHISPERCODE_PUSH_RELAY_URL,
  file: process.env.WHISPERCODE_PUSH_RELAY_DB,
})

console.log(`whispercode-push-relay listening on ${srv.port}`)

process.on("SIGINT", () => {
  void srv.stop().finally(() => process.exit(0))
})

process.on("SIGTERM", () => {
  void srv.stop().finally(() => process.exit(0))
})
