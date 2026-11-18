// Cadangan data di dalam D1: isi semua tabel dikompres (gzip) lalu dipecah per potongan.
// Dibuat otomatis tiap malam (cron) dan sebelum aksi berisiko (reset, impor, pemulihan).
import { runBatched } from './db'

export const BACKUP_TABLES = ['settings', 'stores', 'products', 'variants', 'sku_map', 'sales', 'purchases', 'purchase_items', 'stock_adjustments', 'boosts', 'expenses', 'live_sessions', 'settlements', 'agenda', 'stock_moves'] as const
const CHUNK = 400_000 // karakter base64 per baris, jauh di bawah batas ukuran baris D1
const KEEP = 40 // jumlah cadangan yang disimpan

export interface BackupRow {
  id: number
  created_at: string
  kind: string
  created_by: string | null
  size_bytes: number
  counts: string
}

export async function exportTables(db: D1Database) {
  const out: Record<string, unknown[]> = {}
  for (const t of BACKUP_TABLES) out[t] = (await db.prepare(`SELECT * FROM ${t}`).all()).results
  return out
}

export async function restoreTables(db: D1Database, tables: Record<string, Record<string, unknown>[]>) {
  const counts: Record<string, number> = {}
  // hapus dari tabel anak dulu, hanya tabel yang ada di file
  for (const t of [...BACKUP_TABLES].reverse()) if (tables[t]) await db.prepare(`DELETE FROM ${t}`).run()
  for (const t of BACKUP_TABLES) {
    const rows = tables[t]
    if (!rows?.length) continue
    const have = new Set((await db.prepare(`PRAGMA table_info(${t})`).all<{ name: string }>()).results.map((r) => r.name))
    // kolom yang tidak dikenal (dari versi lain) dilewati supaya pemulihan tidak gagal
    const cols = Object.keys(rows[0]).filter((k) => /^[a-z_]+$/.test(k) && have.has(k))
    const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
    await runBatched(
      db,
      rows.map((r) => db.prepare(sql).bind(...cols.map((k) => (r[k] === undefined ? null : r[k])))),
    )
    counts[t] = rows.length
  }
  return counts
}

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}
async function gunzip(bytes: Uint8Array): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return await new Response(stream).text()
}
function toB64(u: Uint8Array) {
  let s = ''
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(s)
}
const fromB64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0))

export async function makeBackup(db: D1Database, kind: string, by: string | null) {
  const tables = await exportTables(db)
  const json = JSON.stringify({ version: 1, exported_at: new Date().toISOString(), tables })
  const b64 = toB64(await gzip(json))
  const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]))
  const row = await db
    .prepare('INSERT INTO backups (kind, created_by, size_bytes, counts) VALUES (?, ?, ?, ?) RETURNING id')
    .bind(kind, by, json.length, JSON.stringify(counts))
    .first<{ id: number }>()
  const id = row!.id
  const parts: D1PreparedStatement[] = []
  for (let i = 0, n = 0; i < b64.length; i += CHUNK, n++) parts.push(db.prepare('INSERT INTO backup_chunks (backup_id, idx, data) VALUES (?, ?, ?)').bind(id, n, b64.slice(i, i + CHUNK)))
  await runBatched(db, parts)
  // simpan yang terbaru saja
  const old = (await db.prepare(`SELECT id FROM backups ORDER BY id DESC LIMIT -1 OFFSET ${KEEP}`).all<{ id: number }>()).results
  for (const o of old) await db.batch([db.prepare('DELETE FROM backup_chunks WHERE backup_id = ?').bind(o.id), db.prepare('DELETE FROM backups WHERE id = ?').bind(o.id)])
  return id
}

export async function readBackup(db: D1Database, id: number) {
  const chunks = (await db.prepare('SELECT data FROM backup_chunks WHERE backup_id = ? ORDER BY idx').bind(id).all<{ data: string }>()).results
  if (!chunks.length) return null
  return await gunzip(fromB64(chunks.map((c) => c.data).join('')))
}

export async function listBackups(db: D1Database) {
  return (await db.prepare('SELECT * FROM backups ORDER BY id DESC').all<BackupRow>()).results
}
