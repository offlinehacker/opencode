import type { Todo } from "@opencode-ai/sdk/v2/client"

export function copyTodos(todos: Todo[]) {
  return todos.map((todo) => ({ ...todo }))
}

export function todoMode(input: {
  force?: boolean
  store?: Todo[]
  cache?: Todo[]
}) {
  if (input.force) return "fetch" as const
  if (input.store !== undefined) return "store" as const
  if (input.cache !== undefined) return "cache" as const
  return "fetch" as const
}
