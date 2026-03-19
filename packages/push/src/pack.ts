type Exports = {
  [key: string]: string | Exports
}

export type Pkg = {
  main?: string
  bin?: Record<string, string>
  exports?: Exports
}

export function file(value: string) {
  return value.replace("./src/", "./dist/src/").replace(".ts", "")
}

export function rewrite(pkg: Pkg) {
  const next = JSON.parse(JSON.stringify(pkg)) as Pkg

  if (next.bin) {
    for (const [key, value] of Object.entries(next.bin)) {
      next.bin[key] = `${file(value)}.js`
    }
  }

  if (next.exports) {
    const root = next.exports["."]
    if (typeof root === "string") {
      next.main = `${file(root)}.js`
    }
    map(next.exports)
  }

  return next
}

function map(node: Exports) {
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === "string") {
      const next = file(value)
      node[key] = {
        import: `${next}.js`,
        types: `${next}.d.ts`,
      }
      continue
    }

    map(value)
  }
}
