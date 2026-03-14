import fs from "fs"
import path from "path"
import { Database } from "bun:sqlite"
import { randomUUID } from "crypto"
import { file as dbFile } from "./path"
import { equal, hash, verify } from "./sign"

export type PairState = "pending" | "claimed" | "active" | "expired" | "failed"

type PairStart = {
  apns_token: string
  device_name: string
  app_version: string
}

type PairClaim = {
  pair_token: string
  plugin_version: string
  server_label: string
}

type Check = {
  v: 1
  channel_id: string
  checked_at: number
  plugin_version?: string
  sig: string
}

type Pub = {
  v: 1
  channel_id: string
  event_id: string
  kind: string
  session_id: string | null
  request_id: string | null
  occurred_at: number
  collapse_id: string
  sig: string
}

type DeviceAuth = {
  channel_id: string
  device_id: string
  device_secret: string
}

type DeviceToken = DeviceAuth & {
  apns_token: string
}

type DevicePrefs = DeviceAuth & {
  prefs: Prefs
}

type DeviceTest = DeviceAuth

export type Prefs = {
  complete: boolean
  approval: boolean
  question: boolean
  error: boolean
}

type Send = {
  accepted: boolean
  suppressed?: boolean
  reason?: string
  delivery_id?: string
  device_id?: string
  token?: string
  channel_id?: string
  session_id?: string | null
  kind?: string
  collapse_id?: string
}

type Row = Record<string, string | number | null>

export class RelayErr extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
  ) {
    super(message ?? code)
  }
}

export class Store {
  readonly db: Database
  readonly pairMs: number

  constructor(opts?: { file?: string; pairMs?: number }) {
    const file = opts?.file ?? dbFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.db = new Database(file, { create: true })
    this.pairMs = opts?.pairMs ?? 10 * 60_000
    this.db.exec("PRAGMA journal_mode = WAL")
    this.db.exec("PRAGMA synchronous = NORMAL")
    this.db.exec("PRAGMA foreign_keys = ON")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pair_request (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL UNIQUE,
        apns_token TEXT NOT NULL,
        device_name TEXT NOT NULL,
        app_version TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        channel_id TEXT,
        device_id TEXT
      );
      CREATE TABLE IF NOT EXISTS channel (
        id TEXT PRIMARY KEY,
        secret TEXT NOT NULL,
        server_label TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS device (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        secret TEXT NOT NULL,
        apns_token TEXT NOT NULL,
        prefs_json TEXT NOT NULL,
        error_code TEXT,
        last_seen_at INTEGER,
        revoked_at INTEGER,
        FOREIGN KEY(channel_id) REFERENCES channel(id)
      );
      CREATE TABLE IF NOT EXISTS delivery (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        device_id TEXT,
        event_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        session_id TEXT,
        collapse_id TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(channel_id) REFERENCES channel(id),
        FOREIGN KEY(device_id) REFERENCES device(id)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS delivery_event_idx ON delivery(channel_id, event_id);
      CREATE TABLE IF NOT EXISTS channel_checkin (
        channel_id TEXT PRIMARY KEY,
        plugin_version TEXT,
        last_seen_at INTEGER NOT NULL,
        FOREIGN KEY(channel_id) REFERENCES channel(id)
      );
    `)
    try {
      this.db.exec(`ALTER TABLE device ADD COLUMN error_code TEXT`)
    } catch {}
  }

  close() {
    this.db.close()
  }

  start(input: PairStart, root: string) {
    const token = id("ptok")
    const pair = id("pair")
    const now = Date.now()
    const exp = now + this.pairMs
    this.db
      .prepare(
        `INSERT INTO pair_request (id, token_hash, apns_token, device_name, app_version, status, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(pair, hash(token), input.apns_token, input.device_name, input.app_version, "pending", exp, now)
    return {
      pair_id: pair,
      pair_token: token,
      expires_at: new Date(exp).toISOString(),
      install_command: cmd(root, token),
    }
  }

  pair(id: string) {
    const row = this.row(`SELECT * FROM pair_request WHERE id = ?`, id)
    if (!row) throw new RelayErr(404, "pair_not_found")
    this.expire(row)

    const state = String(row.status) as PairState
    if (state === "expired" || state === "failed") {
      return { status: state }
    }

    if (row.channel_id && row.device_id) {
      const channel = this.row(`SELECT * FROM channel WHERE id = ?`, row.channel_id)
      const device = this.row(`SELECT * FROM device WHERE id = ?`, row.device_id)
      if (device?.revoked_at) {
        this.db.prepare(`UPDATE pair_request SET status = 'failed' WHERE id = ?`).run(id)
        return {
          status: "failed",
          message: typeof device.error_code === "string" ? device.error_code : "device_inactive",
        }
      }
      if (channel?.last_seen_at && device?.secret) {
        this.db.prepare(`UPDATE pair_request SET status = 'active' WHERE id = ?`).run(id)
        return {
          status: "active",
          channel_id: String(row.channel_id),
          device_id: String(row.device_id),
          device_secret: String(device.secret),
        }
      }
      if (state === "pending") {
        this.db.prepare(`UPDATE pair_request SET status = 'claimed' WHERE id = ?`).run(id)
      }
      return { status: "claimed" }
    }

    return { status: state }
  }

  claim(input: PairClaim, root: string) {
    const row = this.row(`SELECT * FROM pair_request WHERE token_hash = ?`, hash(input.pair_token))
    if (!row) throw new RelayErr(404, "pair_not_found")
    this.expire(row)
    if (row.status === "expired") throw new RelayErr(410, "pair_expired")
    if (row.status === "failed") throw new RelayErr(409, "pair_failed")

    if (row.channel_id) {
      const prev = this.row(`SELECT * FROM channel WHERE id = ?`, row.channel_id)
      if (!prev?.secret) throw new RelayErr(500, "channel_missing")
      return {
        relay_url: root,
        channel_id: String(prev.id),
        channel_secret: String(prev.secret),
      }
    }

    const channel = id("ch")
    const secret = id("csec")
    const device = id("dev")
    const dsec = id("dsec")
    const now = Date.now()
    this.db.transaction(() => {
      this.db
        .prepare(`INSERT INTO channel (id, secret, server_label, created_at) VALUES (?, ?, ?, ?)`)
        .run(channel, secret, input.server_label, now)
      this.db
        .prepare(`INSERT INTO device (id, channel_id, secret, apns_token, prefs_json) VALUES (?, ?, ?, ?, ?)`)
        .run(device, channel, dsec, String(row.apns_token), JSON.stringify(prefs()))
      this.db
        .prepare(`UPDATE pair_request SET status = 'claimed', channel_id = ?, device_id = ? WHERE id = ?`)
        .run(channel, device, String(row.id))
      this.db
        .prepare(`INSERT OR REPLACE INTO channel_checkin (channel_id, plugin_version, last_seen_at) VALUES (?, ?, ?)`)
        .run(channel, input.plugin_version, 0)
    })()

    return {
      relay_url: root,
      channel_id: channel,
      channel_secret: secret,
    }
  }

  checkin(input: Check) {
    const body = omit(input)
    const row = this.row(`SELECT * FROM channel WHERE id = ?`, input.channel_id)
    if (!row?.secret) throw new RelayErr(404, "channel_not_found")
    if (!verify(String(row.secret), body, input.sig)) throw new RelayErr(401, "bad_signature")
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE channel SET last_seen_at = ? WHERE id = ?`).run(now, input.channel_id)
      this.db.prepare(`UPDATE pair_request SET status = 'active' WHERE channel_id = ?`).run(input.channel_id)
      this.db
        .prepare(`INSERT OR REPLACE INTO channel_checkin (channel_id, plugin_version, last_seen_at) VALUES (?, ?, ?)`)
        .run(input.channel_id, input.plugin_version ?? null, now)
    })()
    return { ok: true }
  }

  putToken(input: DeviceToken) {
    const dev = this.device(input)
    const now = Date.now()
    this.db
      .prepare(`UPDATE device SET apns_token = ?, error_code = NULL, last_seen_at = ? WHERE id = ?`)
      .run(input.apns_token, now, input.device_id)
    return {
      ok: true,
      channel_id: String(dev.channel_id),
      device_id: String(dev.id),
    }
  }

  putPrefs(input: DevicePrefs) {
    const dev = this.device(input)
    const now = Date.now()
    this.db
      .prepare(`UPDATE device SET prefs_json = ?, error_code = NULL, last_seen_at = ? WHERE id = ?`)
      .run(JSON.stringify(input.prefs), now, input.device_id)
    return {
      ok: true,
      channel_id: String(dev.channel_id),
      device_id: String(dev.id),
      prefs: input.prefs,
    }
  }

  test(input: DeviceTest) {
    const dev = this.device(input)
    const idd = id("dlv")
    this.db
      .prepare(
        `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, session_id, collapse_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(idd, input.channel_id, input.device_id, id("evt"), "test", null, "test:device", "queued", Date.now())
    return {
      accepted: true,
      delivery_id: idd,
      device_id: String(dev.id),
      token: String(dev.apns_token),
      channel_id: input.channel_id,
      session_id: null,
      kind: "test",
      collapse_id: "test:device",
    } satisfies Send
  }

  deleteDevice(input: DeviceAuth) {
    const dev = this.device(input)
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE device SET revoked_at = ? WHERE id = ?`).run(now, input.device_id)
      this.db.prepare(`UPDATE pair_request SET status = 'failed' WHERE device_id = ?`).run(input.device_id)
    })()
    return {
      ok: true,
      channel_id: String(dev.channel_id),
      device_id: String(dev.id),
    }
  }

  publish(input: Pub) {
    const body = omit(input)
    const row = this.row(`SELECT * FROM channel WHERE id = ?`, input.channel_id)
    if (!row?.secret) throw new RelayErr(404, "channel_not_found")
    if (!verify(String(row.secret), body, input.sig)) throw new RelayErr(401, "bad_signature")

    const dup = this.row(
      `SELECT id, reason FROM delivery WHERE channel_id = ? AND event_id = ?`,
      input.channel_id,
      input.event_id,
    )
    if (dup?.id) {
      return {
        accepted: true,
        suppressed: true,
        reason: "replay",
      } satisfies Send
    }

    const dev = this.row(`SELECT * FROM device WHERE channel_id = ? AND revoked_at IS NULL`, input.channel_id)
    if (!dev?.id) {
      const idd = id("dlv")
      this.db
        .prepare(
          `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, session_id, collapse_id, status, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          idd,
          input.channel_id,
          null,
          input.event_id,
          input.kind,
          input.session_id,
          input.collapse_id,
          "suppressed",
          "no_device",
          Date.now(),
        )
      return {
        accepted: true,
        suppressed: true,
        reason: "no_device",
      } satisfies Send
    }

    const pref = loadPrefs(dev.prefs_json ?? null)
    if (!enabled(pref, input.kind)) {
      const idd = id("dlv")
      this.db
        .prepare(
          `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, session_id, collapse_id, status, reason, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          idd,
          input.channel_id,
          dev.id,
          input.event_id,
          input.kind,
          input.session_id,
          input.collapse_id,
          "suppressed",
          "preferences",
          Date.now(),
        )
      return {
        accepted: true,
        suppressed: true,
        reason: "preferences",
      } satisfies Send
    }

    const idd = id("dlv")
    this.db
      .prepare(
        `INSERT INTO delivery (id, channel_id, device_id, event_id, kind, session_id, collapse_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        idd,
        input.channel_id,
        dev.id,
        input.event_id,
        input.kind,
        input.session_id,
        input.collapse_id,
        "queued",
        Date.now(),
      )
    return {
      accepted: true,
      delivery_id: idd,
      device_id: String(dev.id),
      token: String(dev.apns_token),
      channel_id: input.channel_id,
      session_id: input.session_id,
      kind: input.kind,
      collapse_id: input.collapse_id,
    } satisfies Send
  }

  mark(id: string, status: "sent" | "failed", reason?: string) {
    this.db.prepare(`UPDATE delivery SET status = ?, reason = ? WHERE id = ?`).run(status, reason ?? null, id)
  }

  deactivate(id: string, code?: string) {
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE device SET error_code = ?, revoked_at = ? WHERE id = ?`).run(code ?? null, now, id)
      this.db.prepare(`UPDATE pair_request SET status = 'failed' WHERE device_id = ?`).run(id)
    })()
  }

  private expire(row: Row) {
    const exp = Number(row.expires_at ?? 0)
    if (!exp || Date.now() <= exp) return
    if (row.status === "expired") return
    this.db.prepare(`UPDATE pair_request SET status = 'expired' WHERE id = ?`).run(String(row.id))
    row.status = "expired"
  }

  private row(sql: string, ...args: Array<string | number | null>) {
    return (this.db.prepare(sql).get(...args) as Row | null) ?? null
  }

  private device(input: DeviceAuth) {
    const dev = this.row(
      `SELECT * FROM device WHERE id = ? AND channel_id = ? AND revoked_at IS NULL`,
      input.device_id,
      input.channel_id,
    )
    if (!dev?.secret) throw new RelayErr(404, "device_not_found")
    if (!equal(String(dev.secret), input.device_secret)) throw new RelayErr(401, "bad_device_secret")
    return dev
  }
}

function id(prefix: string) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`
}

function cmd(root: string, token: string) {
  const clean = root.replace(/\/+$/, "")
  const base = `bunx @whispercode/opencode-push install --pair ${token}`
  if (clean === "https://push.whispercode.dev") return base
  return `${base} --relay ${clean}`
}

function omit<T extends { sig: string }>(value: T) {
  const { sig, ...rest } = value
  void sig
  return rest
}

function prefs() {
  return {
    complete: true,
    approval: true,
    question: true,
    error: true,
  } satisfies Prefs
}

function loadPrefs(value: string | number | null) {
  if (typeof value !== "string") return prefs()
  try {
    const parsed = JSON.parse(value) as Partial<Prefs>
    return {
      ...prefs(),
      ...parsed,
    }
  } catch {
    return prefs()
  }
}

function enabled(pref: Prefs, kind: string) {
  switch (kind) {
    case "complete":
      return pref.complete
    case "approval":
      return pref.approval
    case "question":
      return pref.question
    case "error":
      return pref.error
    case "test":
      return true
    default:
      return true
  }
}
