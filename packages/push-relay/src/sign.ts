import { createHash, createHmac, timingSafeEqual } from "crypto"

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

export function hash(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function sign(secret: string, value: unknown) {
  return createHmac("sha256", secret).update(canonical(value)).digest("base64url")
}

export function verify(secret: string, value: unknown, sig: string) {
  const want = Buffer.from(sign(secret, value))
  const got = Buffer.from(sig)
  if (want.length !== got.length) return false
  return timingSafeEqual(want, got)
}

export function equal(a: string, b: string) {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}
