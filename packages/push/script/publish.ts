#!/usr/bin/env bun

import { Script } from "@opencode-ai/script"
import { $ } from "bun"
import { readdir, rm } from "node:fs/promises"
import { fileURLToPath } from "url"
import { rewrite, type Pkg } from "../src/pack"

const dir = fileURLToPath(new URL("..", import.meta.url))

async function main() {
  process.chdir(dir)

  const raw = (await import("../package.json").then((mod) => mod.default)) as Pkg
  const text = JSON.stringify(raw, null, 2) + "\n"

  try {
    await $`bun tsc`
    const pkg = rewrite(raw)
    await Bun.write("package.json", JSON.stringify(pkg, null, 2) + "\n")
    const list = await readdir(".")
    for (const item of list) {
      if (!item.endsWith(".tgz")) continue
      await rm(item, { force: true })
    }
    await $`bun pm pack`
    await $`npm publish *.tgz --tag ${Script.channel} --access public`
  } finally {
    await Bun.write("package.json", text)
  }
}

if (import.meta.main) {
  await main()
}
