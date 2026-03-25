import { defineConfig } from "vite"
import appPlugin from "@opencode-ai/app/vite"

export default defineConfig({
  plugins: [appPlugin],
  envDir: "../app",
  publicDir: "../app/public",
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 1421,
    strictPort: true,
  },
  build: {
    outDir: "WebAssets",
    emptyOutDir: true,
    target: "esnext",
    assetsDir: ".",
  },
})
