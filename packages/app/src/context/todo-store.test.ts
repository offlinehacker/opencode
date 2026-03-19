import { describe, expect, test } from "bun:test"
import type { Todo } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { copyTodos, todoMode } from "./todo-store"

const item = (content: string, status = "pending") =>
  ({
    content,
    status,
    priority: "medium",
  }) as Todo

describe("todoMode", () => {
  test("forces a refetch even when store and cache exist", () => {
    expect(
      todoMode({
        force: true,
        store: [item("store")],
        cache: [item("cache")],
      }),
    ).toBe("fetch")
  })

  test("reuses the session store before the global cache", () => {
    expect(
      todoMode({
        store: [item("store")],
        cache: [item("cache")],
      }),
    ).toBe("store")
  })

  test("hydrates from cache when the session store is empty", () => {
    expect(
      todoMode({
        cache: [item("cache")],
      }),
    ).toBe("cache")
  })
})

describe("copyTodos", () => {
  test("supports full replacement without stale entries", () => {
    const [store, setStore] = createStore({
      todo: copyTodos([item("one"), item("two"), item("three")]),
    })

    setStore("todo", copyTodos([item("done", "completed")]))
    expect(store.todo).toEqual([item("done", "completed")])

    setStore("todo", copyTodos([]))
    expect(store.todo).toEqual([])
  })
})
