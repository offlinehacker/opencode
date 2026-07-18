import { defineConfig } from "vite"
import appPlugin from "@opencode-ai/app/vite"

export default defineConfig({
  plugins: [appPlugin],
  publicDir: "../app/public",
  server: {
    host: "0.0.0.0",
    port: 1422,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    assetsDir: ".",
  },
})
