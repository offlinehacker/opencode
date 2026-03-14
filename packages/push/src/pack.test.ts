import { describe, expect, test } from "bun:test"
import pkg from "../package.json"
import { file, rewrite } from "./pack"

describe("pack", () => {
  test("maps source files into dist files", () => {
    expect(file("./src/cli.ts")).toBe("./dist/src/cli")
    expect(file("./src/index.ts")).toBe("./dist/src/index")
  })

  test("rewrites bin and exports for publish", () => {
    const next = rewrite(pkg)

    expect(next.bin).toEqual({
      "opencode-push": "./dist/src/cli.js",
    })
    expect(next.exports).toEqual({
      ".": {
        import: "./dist/src/index.js",
        types: "./dist/src/index.d.ts",
      },
    })
    expect(pkg.bin).toEqual({
      "opencode-push": "./src/cli.ts",
    })
    expect(pkg.exports).toEqual({
      ".": "./src/index.ts",
    })
  })
})
