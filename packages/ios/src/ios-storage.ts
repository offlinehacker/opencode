import type { AsyncStorage } from "@solid-primitives/storage"
import { bridge } from "./bridge"

type MemoryStore = {
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string) => Promise<void>
  remove: (key: string) => Promise<void>
  clear: () => Promise<void>
  key: (index: number) => Promise<string | null>
  length: () => Promise<number>
}

type BridgeStorage = AsyncStorage & {
  clear: () => Promise<void>
  key: (index: number) => Promise<string | null>
  getLength: () => Promise<number>
  length: Promise<number>
}

const cache = new Map<string, BridgeStorage>()

const createMemoryStore = (): MemoryStore => {
  const data = new Map<string, string>()
  return {
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => {
      data.set(key, value)
    },
    remove: async (key: string) => {
      data.delete(key)
    },
    clear: async () => {
      data.clear()
    },
    key: async (index: number) => Array.from(data.keys())[index] ?? null,
    length: async () => data.size,
  }
}

export const createBridgeStorage = (name = "default.dat") => {
  const cached = cache.get(name)
  if (cached) return cached

  const memory = createMemoryStore()

  const api: BridgeStorage = {
    getItem: async (key: string) => {
      if (!bridge.available()) return memory.get(key)
      const value = await bridge.sendAsync<string | null>("storageGet", { name, key })
      if (value === undefined || value === null) return null
      return value
    },
    setItem: async (key: string, value: string) => {
      if (!bridge.available()) return memory.set(key, value)
      await bridge.sendAsync("storageSet", { name, key, value })
    },
    removeItem: async (key: string) => {
      if (!bridge.available()) return memory.remove(key)
      await bridge.sendAsync("storageRemove", { name, key })
    },
    clear: async () => {
      if (!bridge.available()) return memory.clear()
      await bridge.sendAsync("storageClear", { name })
    },
    key: async (index: number) => {
      if (!bridge.available()) return memory.key(index)
      const value = await bridge.sendAsync<string | null>("storageKey", { name, index })
      return value ?? null
    },
    getLength: async () => {
      if (!bridge.available()) return memory.length()
      const value = await bridge.sendAsync<number>("storageLength", { name })
      return typeof value === "number" ? value : 0
    },
    get length() {
      return api.getLength()
    },
  }

  cache.set(name, api)
  return api
}
