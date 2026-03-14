import { createHmac } from "crypto"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }

function sort(value: unknown): Json {
  if (value === null) return null
  if (typeof value === "boolean" || typeof value === "number" || typeof value === "string") return value
  if (Array.isArray(value)) return value.map(sort)
  if (!value || typeof value !== "object") return null

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sort(item)]),
  )
}

export function canonical(value: unknown) {
  return JSON.stringify(sort(value))
}

export function sign(secret: string, value: unknown) {
  return createHmac("sha256", secret).update(canonical(value)).digest("base64url")
}

export function signed<T extends Record<string, unknown>>(secret: string, value: T) {
  return { ...value, sig: sign(secret, value) }
}
