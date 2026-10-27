import { DEFAULT_SETTINGS, SCHEMA } from './schema'

export interface Env {
  DB: D1Database
  APP_PASSWORD?: string
  SESSION_SECRET?: string
}

let schemaReady = false

export async function ensureSchema(db: D1Database) {
  if (schemaReady) return
  await db.batch(SCHEMA.map((sql) => db.prepare(sql)))
  const existing = await db.prepare('SELECT key FROM settings').all<{ key: string }>()
  const have = new Set(existing.results.map((r) => r.key))
  const missing = Object.entries(DEFAULT_SETTINGS).filter(([k]) => !have.has(k))
  if (missing.length) {
    await db.batch(missing.map(([k, v]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(k, v)))
  }
  schemaReady = true
}

export async function getSettings(db: D1Database): Promise<Record<string, string>> {
  const rows = await db.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>()
  const out: Record<string, string> = { ...DEFAULT_SETTINGS }
  for (const r of rows.results) out[r.key] = r.value
  return out
}

export function num(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : fallback
}

// D1 membatasi jumlah statement per batch; pecah menjadi beberapa batch.
export async function runBatched(db: D1Database, stmts: D1PreparedStatement[], size = 80) {
  for (let i = 0; i < stmts.length; i += size) {
    await db.batch(stmts.slice(i, i + size))
  }
}
