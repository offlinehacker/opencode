import { log } from "./log"

export type RateLimitTier = "strict" | "standard" | "generous"

export type TierConfig = {
  limit: number
  windowMs: number
}

export type RateLimitConfig = {
  tiers: Record<RateLimitTier, TierConfig>
  routes: Array<{ method: string; pattern: string; tier: RateLimitTier | "exempt" }>
  cleanupIntervalMs?: number
}

export type RateLimitResult = {
  allowed: boolean
  limit: number
  remaining: number
  retryAfterMs: number
}

type WindowEntry = {
  prevCount: number
  currCount: number
  windowStart: number
}

export function defaultRateLimitConfig(): RateLimitConfig {
  return {
    tiers: {
      strict: { limit: 10, windowMs: 60_000 },
      standard: { limit: 30, windowMs: 60_000 },
      generous: { limit: 120, windowMs: 60_000 },
    },
    routes: [
      { method: "GET", pattern: "/health", tier: "exempt" },
      { method: "POST", pattern: "/v1/pair/start", tier: "strict" },
      { method: "POST", pattern: "/v1/pair/claim", tier: "standard" },
      { method: "GET", pattern: "/v1/pair/:id", tier: "standard" },
      { method: "PUT", pattern: "/v1/device/token", tier: "standard" },
      { method: "PUT", pattern: "/v1/device/preferences", tier: "standard" },
      { method: "POST", pattern: "/v1/device/test", tier: "standard" },
      { method: "DELETE", pattern: "/v1/device", tier: "standard" },
      { method: "POST", pattern: "/v1/channel/devices", tier: "standard" },
      { method: "POST", pattern: "/v1/channel/device/remove", tier: "standard" },
      { method: "POST", pattern: "/v1/events/publish", tier: "generous" },
      { method: "POST", pattern: "/v1/channel/checkin", tier: "generous" },
    ],
  }
}

export function defaultIpExtractor(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim()
    if (first) return first
  }
  const realIp = req.headers.get("x-real-ip")
  if (realIp) return realIp
  return "unknown"
}

export function routeKey(method: string, path: string): string {
  // Normalize /v1/pair/<anything> → /v1/pair/:id
  if (method === "GET" && path.startsWith("/v1/pair/") && path !== "/v1/pair/") {
    return "GET /v1/pair/:id"
  }
  return `${method} ${path}`
}

export function createRateLimiter(config: RateLimitConfig) {
  const entries = new Map<string, WindowEntry>()
  const cleanupMs = config.cleanupIntervalMs ?? 60_000
  const maxEntries = 50_000

  // Build a lookup map from "METHOD /path" → tier
  const routeMap = new Map<string, RateLimitTier | "exempt">()
  for (const r of config.routes) {
    routeMap.set(`${r.method} ${r.pattern}`, r.tier)
  }

  const timer = setInterval(() => {
    const now = Date.now()
    for (const [key, entry] of entries) {
      const tier = key.split(":").pop() as RateLimitTier
      const windowMs = config.tiers[tier]?.windowMs ?? 60_000
      if (now - entry.windowStart > 2 * windowMs) {
        entries.delete(key)
      }
    }
    if (entries.size > maxEntries) {
      const excess = entries.size - maxEntries
      let deleted = 0
      for (const key of entries.keys()) {
        if (deleted >= excess) break
        entries.delete(key)
        deleted++
      }
    }
  }, cleanupMs)
  timer.unref()

  function check(ip: string, method: string, path: string): RateLimitResult {
    const rk = routeKey(method, path)
    const tier = routeMap.get(rk)

    // Unknown routes default to standard tier
    if (tier === undefined) {
      return checkTier(ip, "standard", config.tiers.standard)
    }
    if (tier === "exempt") {
      return { allowed: true, limit: 0, remaining: 0, retryAfterMs: 0 }
    }
    return checkTier(ip, tier, config.tiers[tier])
  }

  function checkTier(ip: string, tier: RateLimitTier, tc: TierConfig): RateLimitResult {
    const now = Date.now()
    const key = `${ip}:${tier}`
    let entry = entries.get(key)

    if (!entry) {
      entry = { prevCount: 0, currCount: 0, windowStart: now }
      entries.set(key, entry)
    }

    // Roll window if needed
    const elapsed = now - entry.windowStart
    if (elapsed >= tc.windowMs) {
      const windowsPassed = Math.floor(elapsed / tc.windowMs)
      if (windowsPassed >= 2) {
        entry.prevCount = 0
        entry.currCount = 0
      } else {
        entry.prevCount = entry.currCount
        entry.currCount = 0
      }
      entry.windowStart = entry.windowStart + windowsPassed * tc.windowMs
    }

    // Sliding window estimate
    const elapsedInWindow = now - entry.windowStart
    const fraction = elapsedInWindow / tc.windowMs
    const effective = entry.prevCount * (1 - fraction) + entry.currCount

    if (effective >= tc.limit) {
      const retryAfterMs = Math.ceil(tc.windowMs - elapsedInWindow)
      return {
        allowed: false,
        limit: tc.limit,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1000),
      }
    }

    entry.currCount++
    const remaining = Math.max(0, Math.floor(tc.limit - effective - 1))
    return { allowed: true, limit: tc.limit, remaining, retryAfterMs: 0 }
  }

  return {
    check,
    stop: () => clearInterval(timer),
  }
}
