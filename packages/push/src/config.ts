import fs from "fs/promises"
import path from "path"
import { applyEdits, modify, parse } from "jsonc-parser"
import { cfgDir } from "./path.js"

const files = ["opencode.jsonc", "opencode.json", "config.json"]

export function name(spec: string) {
  const idx = spec.lastIndexOf("@")
  if (idx > 0) return spec.slice(0, idx)
  return spec
}

export function merge(list: string[], spec: string) {
  const pkg = name(spec)
  const next = list.filter((item) => name(item) !== pkg)
  next.push(spec)
  return next
}

export function cut(list: string[], pkg: string) {
  return list.filter((item) => name(item) !== pkg)
}

export async function file() {
  const dir = cfgDir()
  for (const name of files) {
    const file = path.join(dir, name)
    const ok = await fs
      .stat(file)
      .then(() => true)
      .catch(() => false)
    if (ok) return file
  }
  return path.join(dir, "opencode.jsonc")
}

export async function read() {
  const src = await file()
  const text = await fs.readFile(src, "utf8").catch(() => "{}\n")
  const data = parse(text) as { plugin?: string[] } | undefined
  return { src, text, data: data ?? {} }
}

export async function write(src: string, text: string, list: string[]) {
  await fs.mkdir(path.dirname(src), { recursive: true })
  if (src.endsWith(".jsonc")) {
    const edits = modify(text || "{}\n", ["plugin"], list, {
      formattingOptions: {
        insertSpaces: true,
        tabSize: 2,
        eol: "\n",
      },
    })
    const next = applyEdits(text || "{}\n", edits)
    await fs.writeFile(src, next.endsWith("\n") ? next : next + "\n", "utf8")
    return
  }

  const data = parse(text || "{}") as Record<string, unknown>
  data.plugin = list
  await fs.writeFile(src, JSON.stringify(data, null, 2) + "\n", "utf8")
}
