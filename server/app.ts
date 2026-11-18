import { computeRestock, DEFAULT_RESTOCK, type RestockParams } from '../shared/restock'
import { Hono } from 'hono'
import { checkOwnerPassword, checkPassword, clearOwnerCookie, clearSessionCookie, hashPassword, isOwner, makeOwnerCookie, makeSessionCookie, sessionUid, verifyPassword } from './auth'
import type { AgendaItem } from '../shared/agenda'
import { moveKind } from '../shared/moves'
import { BACKUP_TABLES, exportTables, listBackups, makeBackup, readBackup, restoreTables } from './backup'
import { computeKpi, kpiMonthKey, parseKpiConfig, parseKpiMonth, type KpiConfig, type KpiContext, type KpiMonthRecord } from '../shared/kpi'
import { ensureSchema, getSettings, num, runBatched, type Env } from './db'
import { DEFAULT_SETTINGS } from './schema'
import { buildDashboard } from '../shared/dashboard'
import { computeMonthly, computeStock, type DataBundle } from '../shared/metrics'
import { commissionFor, parseTeamCommission, teamPct } from '../shared/commission'
import { buildLiveReport, lateMinutes, type LiveSession } from '../shared/live'
import { PRIVATE_EXPENSE_CATEGORIES, type ImportedSaleLine } from '../shared/types'

type SessionUser = { id: number; name: string; role: string }
const app = new Hono<{ Bindings: Env; Variables: { user: SessionUser } }>().basePath('/api')

// Pesan error untuk pengguna dibuat umum; detail teknis (nama tabel/kolom database) hanya masuk log server.
app.onError((err, c) => {
  console.error(err)
  const msg = err.message || ''
  const technical = /D1_|SQLITE|constraint|no such (table|column)|syntax error|TypeError|Cannot read|undefined|null/i.test(msg)
  return c.json({ error: technical || !msg ? 'Terjadi kesalahan di server. Periksa isian, lalu coba lagi.' : msg }, 500)
})

// Header keamanan untuk semua respons API
app.use('*', async (c, next) => {
  await next()
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store')
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin')
})

// Perlindungan CSRF: permintaan yang mengubah data wajib JSON dan harus berasal dari portal ini sendiri.
app.use('*', async (c, next) => {
  const m = c.req.method
  if (m === 'GET' || m === 'HEAD' || m === 'OPTIONS') return next()
  const site = c.req.header('Sec-Fetch-Site')
  if (site && site !== 'same-origin' && site !== 'none') return c.json({ error: 'Permintaan ditolak' }, 403)
  const origin = c.req.header('Origin')
  if (origin && new URL(origin).host !== new URL(c.req.url).host) return c.json({ error: 'Permintaan ditolak' }, 403)
  const ct = c.req.header('Content-Type') ?? ''
  const hasBody = Number(c.req.header('Content-Length') ?? '0') > 0 || !!c.req.header('Transfer-Encoding')
  if (hasBody && !ct.includes('application/json')) return c.json({ error: 'Format permintaan tidak didukung' }, 415)
  return next()
})

// ---------- Autentikasi: akun per orang (tabel users) ----------
const PUBLIC = new Set(['/api/login', '/api/logout', '/api/login-info'])
const accountsEnabled = async (db: D1Database) => ((await db.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').first<{ n: number }>())?.n ?? 0) > 0

// Batas percobaan: 5 kali salah per akun (atau 20 kali per perangkat/IP) dalam 15 menit → dikunci 15 menit.
const WINDOW_MIN = 15
const MAX_PER_ACCOUNT = 5
const MAX_PER_IP = 20
const clientIp = (c: { req: { header: (k: string) => string | undefined } }) => c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? 'lokal'
async function lockedMinutes(db: D1Database, keys: [string, number][]) {
  let worst = 0
  for (const [key, max] of keys) {
    const r = await db
      .prepare(`SELECT COUNT(*) AS n, MIN(at) AS first FROM login_attempts WHERE key = ? AND at > datetime('now', '-${WINDOW_MIN} minutes')`)
      .bind(key)
      .first<{ n: number; first: string | null }>()
    if (r && r.n >= max && r.first) {
      const left = WINDOW_MIN - Math.floor((Date.now() - Date.parse(`${r.first.replace(' ', 'T')}Z`)) / 60000)
      worst = Math.max(worst, Math.max(1, left))
    }
  }
  return worst
}
async function recordFailure(db: D1Database, keys: string[]) {
  await db.batch([
    ...keys.map((k) => db.prepare('INSERT INTO login_attempts (key) VALUES (?)').bind(k)),
    db.prepare("DELETE FROM login_attempts WHERE at < datetime('now', '-1 day')"),
  ])
}
const clearFailures = (db: D1Database, key: string) => db.prepare('DELETE FROM login_attempts WHERE key = ?').bind(key).run()
const auditRaw = (db: D1Database, who: string, action: string, area: string, summary: string, path: string) =>
  db.prepare('INSERT INTO audit_log (user_name, action, area, summary, method, path) VALUES (?,?,?,?,?,?)').bind(who, action, area, summary, 'POST', path).run()
// hash tiruan: dipakai saat nama pengguna tidak ada, supaya waktu respons sama dengan akun yang ada
let dummyHash: { hash: string; salt: string } | null = null

app.use('*', async (c, next) => {
  if (!c.env.DB) return c.json({ error: 'Database D1 belum terhubung (binding "DB"). Lihat README.' }, 503)
  await ensureSchema(c.env.DB)
  return next()
})
app.get('/login-info', async (c) => c.json({ accounts: await accountsEnabled(c.env.DB) }))
app.post('/login', async (c) => {
  const body = await c.req.json<{ username?: string; password?: string }>().catch(() => ({}) as { username?: string; password?: string })
  const username = (body.username ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const db = c.env.DB
  const ip = clientIp(c)
  const userKey = `login:${username || '(tim)'}`
  const ipKey = `ip:${ip}`
  const wait = await lockedMinutes(db, [
    [userKey, MAX_PER_ACCOUNT],
    [ipKey, MAX_PER_IP],
  ])
  if (wait) return c.json({ error: `Terlalu banyak percobaan masuk. Coba lagi dalam ${wait} menit.` }, 429)
  let uid: number | null = null
  if (username === 'owner') {
    if (checkOwnerPassword(password, c.env)) uid = -1
  } else if (username) {
    const u = await db.prepare('SELECT id, pass_hash, pass_salt FROM users WHERE lower(username) = ? AND active = 1').bind(username).first<{ id: number; pass_hash: string; pass_salt: string }>()
    if (u) {
      if (await verifyPassword(password, u.pass_hash, u.pass_salt)) uid = u.id
    } else {
      dummyHash = dummyHash ?? (await hashPassword('glamora-dummy'))
      await verifyPassword(password, dummyHash.hash, dummyHash.salt)
    }
  } else if (!(await accountsEnabled(db))) {
    if (!c.env.APP_PASSWORD) return c.json({ error: 'APP_PASSWORD belum diatur di Cloudflare (lihat README).' }, 503)
    if (checkPassword(password, c.env)) uid = 0
  } else {
    return c.json({ error: 'Masukkan nama pengguna. Kata sandi tim bersama sudah tidak dipakai.' }, 401)
  }
  if (uid == null) {
    await recordFailure(db, [userKey, ipKey])
    const now = await lockedMinutes(db, [[userKey, MAX_PER_ACCOUNT]])
    if (now) await auditRaw(db, username || '(tanpa nama)', 'diblokir', 'Login', `${MAX_PER_ACCOUNT}x salah kata sandi, dikunci ${WINDOW_MIN} menit (IP ${ip})`, '/api/login')
    return c.json({ error: 'Nama pengguna atau kata sandi salah' }, 401)
  }
  await clearFailures(db, userKey)
  c.header('Set-Cookie', await makeSessionCookie(c.env, uid))
  // kunci owner dari pengguna sebelumnya di browser ini tidak ikut terbawa
  c.header('Set-Cookie', clearOwnerCookie(), { append: true })
  return c.json({ ok: true })
})

app.post('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie())
  c.header('Set-Cookie', clearOwnerCookie(), { append: true })
  return c.json({ ok: true })
})

app.use('*', async (c, next) => {
  if (PUBLIC.has(c.req.path)) return next()
  const uid = await sessionUid(c.req.header('Cookie'), c.env)
  if (uid == null) return c.json({ error: 'Silakan masuk terlebih dahulu' }, 401)
  let user: SessionUser
  if (uid === -1) user = { id: -1, name: 'Owner', role: 'Owner' }
  else if (uid === 0) {
    // sesi kata sandi bersama berhenti berlaku begitu akun per orang dipakai
    if (await accountsEnabled(c.env.DB)) return c.json({ error: 'Silakan masuk dengan akun masing-masing' }, 401)
    user = { id: 0, name: 'Tim (bersama)', role: 'Staf' }
  } else {
    const u = await c.env.DB.prepare('SELECT id, name, role FROM users WHERE id = ? AND active = 1').bind(uid).first<SessionUser>()
    if (!u) return c.json({ error: 'Akun tidak aktif. Silakan masuk lagi.' }, 401)
    user = u
  }
  c.set('user', user)
  return next()
})

// ---------- Riwayat perubahan: setiap simpan/ubah/hapus dicatat ----------
const AREAS: [RegExp, string][] = [
  [/^\/api\/sales\/import/, 'Unggah penjualan'],
  [/^\/api\/sales/, 'Penjualan'],
  [/^\/api\/settlements/, 'Pencairan TikTok'],
  [/^\/api\/purchases/, 'Pembelian & impor'],
  [/^\/api\/(products|variants)/, 'Produk & varian'],
  [/^\/api\/stock\/(moves|receive)/, 'Keluar-masuk barang'],
  [/^\/api\/stock/, 'Stok opname'],
  [/^\/api\/sku-map/, 'Pemetaan SKU'],
  [/^\/api\/catalog\/import/, 'Impor katalog'],
  [/^\/api\/boosts/, 'Boost'],
  [/^\/api\/expenses/, 'Biaya operasional'],
  [/^\/api\/live/, 'Sesi live'],
  [/^\/api\/settings/, 'Pengaturan'],
  [/^\/api\/stores/, 'Toko'],
  [/^\/api\/kpi/, 'KPI'],
  [/^\/api\/data\/import/, 'Impor data'],
  [/^\/api\/data\/backups/, 'Cadangan data'],
  [/^\/api\/data\/reset/, 'Reset data'],
  [/^\/api\/users/, 'Akun tim'],
  [/^\/api\/me\/password/, 'Ganti kata sandi'],
  [/^\/api\/me\/photo/, 'Foto profil'],
  [/^\/api\/agenda/, 'Agenda'],
]
const SKIP_AUDIT = new Set(['/api/login', '/api/logout', '/api/owner/login', '/api/owner/logout'])
function summarize(path: string, body: unknown): string | null {
  if (/^\/api\/me\/photo/.test(path)) return null
  if (/^\/api\/(users|me\/password|owner)/.test(path)) {
    const b = body as Record<string, unknown> | null
    return b && typeof b === 'object' ? [b.name, b.username].filter(Boolean).join(' · ') || null : null
  }
  if (Array.isArray(body)) return `${body.length} baris`
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (Array.isArray(b.products) || Array.isArray(b.variants) || Array.isArray(b.skuMap))
    return `${(b.products as unknown[] | undefined)?.length ?? 0} model, ${(b.variants as unknown[] | undefined)?.length ?? 0} varian, ${(b.skuMap as unknown[] | undefined)?.length ?? 0} pemetaan`
  for (const k of ['rows', 'lines', 'items', 'records']) if (Array.isArray(b[k])) return `${(b[k] as unknown[]).length} baris`
  const pick = ['title', 'name', 'sku', 'code', 'category', 'description', 'order_id', 'start_at', 'exp_date', 'boost_date', 'amount', 'store', 'host']
    .filter((k) => b[k] != null && b[k] !== '')
    .slice(0, 4)
    .map((k) => String(b[k]).slice(0, 60))
  if (pick.length) return pick.join(' · ')
  const keys = Object.keys(b).filter((k) => !/pass/i.test(k))
  return keys.length ? keys.slice(0, 5).join(', ') : null
}
const TARGETS: [RegExp, string][] = [
  [/^\/api\/agenda\/(\d+)/, "SELECT title AS l FROM agenda WHERE id = ?"],
  [/^\/api\/users\/(\d+)/, "SELECT name AS l FROM users WHERE id = ?"],
  [/^\/api\/expenses\/(\d+)/, "SELECT category || ' · ' || exp_date || ' · Rp' || CAST(amount AS INTEGER) AS l FROM expenses WHERE id = ?"],
  [/^\/api\/boosts\/(\d+)/, "SELECT 'Boost ' || boost_date || ' · ' || store AS l FROM boosts WHERE id = ?"],
  [/^\/api\/live\/(\d+)/, "SELECT 'Sesi ' || start_at || COALESCE(' · ' || host, '') AS l FROM live_sessions WHERE id = ?"],
  [/^\/api\/sales\/(\d+)/, "SELECT 'Pesanan ' || order_id AS l FROM sales WHERE id = ?"],
  [/^\/api\/purchases\/(\d+)/, "SELECT name AS l FROM purchases WHERE id = ?"],
  [/^\/api\/stock\/adjustments\/(\d+)/, "SELECT sku || ' ' || qty_delta AS l FROM stock_adjustments WHERE id = ?"],
  [/^\/api\/stores\/(\d+)/, "SELECT name AS l FROM stores WHERE id = ?"],
  [/^\/api\/products\/([^/]+)/, "SELECT code || ' ' || name AS l FROM products WHERE code = ?"],
  [/^\/api\/variants\/([^/]+)/, "SELECT sku AS l FROM variants WHERE sku = ?"],
]
async function targetLabel(db: D1Database, path: string) {
  for (const [re, sql] of TARGETS) {
    const m = path.match(re)
    if (m) return (await db.prepare(sql).bind(decodeURIComponent(m[1])).first<{ l: string }>())?.l ?? `#${m[1]}`
  }
  return null
}
function auditSummary(path: string, method: string, body: unknown, target: string | null) {
  if (/\/agenda\/\d+\/done$/.test(path)) {
    const b = body as { date?: string; done?: boolean } | null
    return `${target ?? ''} · ${b?.date ?? ''} · ${b?.done ? 'ditandai selesai' : 'dibatalkan selesai'}`
  }
  if (/^\/api\/users\/\d+/.test(path)) {
    const b = (body ?? {}) as { active?: boolean; password?: string }
    const what = [b.active === false ? 'dinonaktifkan' : b.active === true ? 'diaktifkan' : null, b.password ? 'kata sandi diganti' : null].filter(Boolean).join(', ')
    return [target, what].filter(Boolean).join(' · ') || null
  }
  if (method === 'DELETE') return target
  const s = summarize(path, body)
  return target && s ? `${target} → ${s}` : (target ?? s)
}
app.use('*', async (c, next) => {
  const method = c.req.method
  if (method === 'GET' || SKIP_AUDIT.has(c.req.path) || PUBLIC.has(c.req.path)) return next()
  let body: unknown = null
  if ((c.req.header('Content-Type') ?? '').includes('application/json')) body = await c.req.json().catch(() => null)
  // nama data yang diubah/dihapus diambil sebelum perubahan, supaya riwayat tetap jelas
  const target = await targetLabel(c.env.DB, c.req.path).catch(() => null)
  await next()
  if (c.res.status >= 400) return
  const path = c.req.path
  const area = AREAS.find(([re]) => re.test(path))?.[1] ?? path.replace('/api/', '')
  const action = path.endsWith('/finalize') ? 'finalisasi' : path.endsWith('/restore') ? 'pulihkan' : method === 'POST' ? 'tambah' : method === 'PUT' ? 'ubah' : method === 'DELETE' ? 'hapus' : method.toLowerCase()
  const u = c.get('user')
  try {
    await c.env.DB.prepare('INSERT INTO audit_log (user_name, action, area, summary, method, path) VALUES (?,?,?,?,?,?)')
      .bind(u?.name ?? '?', action, area, auditSummary(path, method, body, target), method, path)
      .run()
  } catch (e) {
    console.error('audit gagal', e)
  }
})

// ---------- Kunci owner (KPI, pengaturan, data) ----------
const ownerOnly = (path: string, method: string) =>
  path.startsWith('/api/kpi') ||
  path.startsWith('/api/data/') ||
  path.startsWith('/api/users') ||
  path.startsWith('/api/audit') ||
  path.startsWith('/api/team-commission') ||
  (path.startsWith('/api/stores') && method !== 'GET')
// owner dianggap sudah membuka kunci bila masuk dengan akun "owner" atau sudah memasukkan kata sandi owner
const ownerOk = async (c: { req: { header: (k: string) => string | undefined }; env: Env; get: (k: 'user') => SessionUser }) =>
  c.get('user')?.id === -1 || (await isOwner(c.req.header('Cookie'), c.env, c.get('user')?.id ?? -99))
app.use('*', async (c, next) => {
  if (ownerOnly(c.req.path, c.req.method) && !(await ownerOk(c))) {
    return c.json({ error: c.env.OWNER_PASSWORD ? 'Bagian ini hanya untuk owner. Buka kunci dengan kata sandi owner.' : 'OWNER_PASSWORD belum diatur di Cloudflare.' }, 403)
  }
  return next()
})
app.get('/owner', async (c) => c.json({ owner: await ownerOk(c), configured: !!c.env.OWNER_PASSWORD, viaLogin: c.get('user')?.id === -1 }))
app.post('/owner/login', async (c) => {
  if (!c.env.OWNER_PASSWORD) return c.json({ error: 'OWNER_PASSWORD belum diatur di Cloudflare.' }, 503)
  const body = await c.req.json<{ password?: string }>().catch(() => ({ password: '' }))
  const u = c.get('user')
  const key = `owner:${u.id}`
  const ipKey = `ip:${clientIp(c)}`
  const wait = await lockedMinutes(c.env.DB, [
    [key, MAX_PER_ACCOUNT],
    [ipKey, MAX_PER_IP],
  ])
  if (wait) return c.json({ error: `Terlalu banyak percobaan. Coba lagi dalam ${wait} menit.` }, 429)
  if (!checkOwnerPassword(body.password ?? '', c.env)) {
    await recordFailure(c.env.DB, [key, ipKey])
    // percobaan membuka kunci owner yang salah dicatat di riwayat supaya owner tahu
    await auditRaw(c.env.DB, u.name, 'gagal', 'Buka kunci owner', 'Kata sandi owner salah', '/api/owner/login')
    return c.json({ error: 'Kata sandi owner salah' }, 403)
  }
  await clearFailures(c.env.DB, key)
  c.header('Set-Cookie', await makeOwnerCookie(c.env, c.get('user').id))
  return c.json({ ok: true })
})
app.post('/owner/logout', (c) => {
  c.header('Set-Cookie', clearOwnerCookie())
  return c.json({ ok: true })
})

// ---------- Profil & foto ----------
const photoKey = (id: number) => (id === -1 ? 'owner' : id > 0 ? `u:${id}` : null)
app.get('/me', async (c) => {
  const u = c.get('user')
  const key = photoKey(u.id)
  const photo = key ? await c.env.DB.prepare('SELECT updated_at FROM profile_photos WHERE owner_key = ?').bind(key).first<{ updated_at: string }>() : null
  const extra = u.id > 0 ? await c.env.DB.prepare('SELECT username, created_at FROM users WHERE id = ?').bind(u.id).first<{ username: string; created_at: string }>() : null
  return c.json({
    ok: true,
    user: { ...u, username: extra?.username ?? (u.id === -1 ? 'owner' : null), photo: photo && key ? `/api/photo/${key}?v=${encodeURIComponent(photo.updated_at)}` : null },
    accounts: await accountsEnabled(c.env.DB),
  })
})
app.get('/photo/:key', async (c) => {
  const row = await c.env.DB.prepare('SELECT data FROM profile_photos WHERE owner_key = ?').bind(c.req.param('key')).first<{ data: string }>()
  if (!row) return c.json({ error: 'Foto tidak ditemukan' }, 404)
  const m = row.data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
  if (!m) return c.json({ error: 'Foto rusak' }, 500)
  const bytes = Uint8Array.from(atob(m[2]), (ch) => ch.charCodeAt(0))
  return new Response(bytes, { headers: { 'Content-Type': m[1], 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff' } })
})
app.put('/me/photo', async (c) => {
  const key = photoKey(c.get('user').id)
  if (!key) return c.json({ error: 'Masuk dengan akun masing-masing untuk memasang foto.' }, 400)
  const b = await c.req.json<{ data?: string }>()
  const data = String(b.data ?? '')
  if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(data)) return c.json({ error: 'Format foto tidak didukung' }, 400)
  if (data.length > 400_000) return c.json({ error: 'Foto terlalu besar' }, 400)
  await c.env.DB.prepare("INSERT INTO profile_photos (owner_key, data, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(owner_key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at")
    .bind(key, data)
    .run()
  return c.json({ ok: true })
})
app.delete('/me/photo', async (c) => {
  const key = photoKey(c.get('user').id)
  if (key) await c.env.DB.prepare('DELETE FROM profile_photos WHERE owner_key = ?').bind(key).run()
  return c.json({ ok: true })
})
app.put('/me/password', async (c) => {
  const u = c.get('user')
  if (u.id <= 0) return c.json({ error: 'Kata sandi ini diatur di Cloudflare, bukan dari portal.' }, 400)
  const b = await c.req.json<{ old?: string; password?: string }>()
  const row = await c.env.DB.prepare('SELECT pass_hash, pass_salt FROM users WHERE id = ?').bind(u.id).first<{ pass_hash: string; pass_salt: string }>()
  if (!row || !(await verifyPassword(b.old ?? '', row.pass_hash, row.pass_salt))) return c.json({ error: 'Kata sandi lama salah' }, 400)
  if ((b.password ?? '').length < 6) return c.json({ error: 'Kata sandi baru minimal 6 karakter' }, 400)
  const h = await hashPassword(b.password!)
  await c.env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(h.hash, h.salt, u.id).run()
  return c.json({ ok: true })
})

// ---------- Akun tim (khusus owner) ----------
app.get('/users', async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT u.id, u.name, u.username, u.role, u.active, u.created_at, '/api/photo/u:' || u.id || '?v=' || p.updated_at AS photo FROM users u LEFT JOIN profile_photos p ON p.owner_key = 'u:' || u.id ORDER BY u.active DESC, u.name",
      ).all()
    ).results,
  ),
)
app.post('/users', async (c) => {
  const b = await c.req.json<{ name?: string; username?: string; password?: string; role?: string }>()
  const username = (b.username ?? '').trim().toLowerCase()
  if (!b.name?.trim() || !/^[a-z0-9._-]{3,30}$/.test(username)) return c.json({ error: 'Isi nama dan nama pengguna (3–30 huruf kecil/angka, tanpa spasi)' }, 400)
  if (username === 'owner') return c.json({ error: 'Nama pengguna "owner" khusus untuk owner' }, 400)
  if ((b.password ?? '').length < 6) return c.json({ error: 'Kata sandi minimal 6 karakter' }, 400)
  if (await c.env.DB.prepare('SELECT 1 FROM users WHERE lower(username) = ?').bind(username).first()) return c.json({ error: 'Nama pengguna sudah dipakai' }, 400)
  const h = await hashPassword(b.password!)
  await c.env.DB.prepare('INSERT INTO users (name, username, pass_hash, pass_salt, role) VALUES (?,?,?,?,?)').bind(b.name.trim(), username, h.hash, h.salt, b.role?.trim() || 'Staf').run()
  return c.json({ ok: true })
})
app.put('/users/:id', async (c) => {
  const b = await c.req.json<{ name?: string; role?: string; active?: boolean; password?: string }>()
  const id = Number(c.req.param('id'))
  const cur = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<{ name: string; role: string; active: number }>()
  if (!cur) return c.json({ error: 'Akun tidak ditemukan' }, 404)
  if (b.password) {
    if (b.password.length < 6) return c.json({ error: 'Kata sandi minimal 6 karakter' }, 400)
    const h = await hashPassword(b.password)
    await c.env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ? WHERE id = ?').bind(h.hash, h.salt, id).run()
  }
  await c.env.DB.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?')
    .bind(b.name?.trim() || cur.name, b.role?.trim() || cur.role, b.active == null ? cur.active : b.active ? 1 : 0, id)
    .run()
  return c.json({ ok: true })
})
app.get('/audit', async (c) => {
  const user = c.req.query('user')
  const area = c.req.query('area')
  const limit = Math.min(500, Math.max(20, Number(c.req.query('limit')) || 200))
  const where: string[] = []
  const params: string[] = []
  if (user) {
    where.push('user_name = ?')
    params.push(user)
  }
  if (area) {
    where.push('area = ?')
    params.push(area)
  }
  const rows = await c.env.DB.prepare(`SELECT * FROM audit_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ${limit}`)
    .bind(...params)
    .all()
  const users = await c.env.DB.prepare('SELECT DISTINCT user_name FROM audit_log ORDER BY user_name').all<{ user_name: string }>()
  const areas = await c.env.DB.prepare('SELECT DISTINCT area FROM audit_log ORDER BY area').all<{ area: string }>()
  return c.json({ rows: rows.results, users: users.results.map((x) => x.user_name), areas: areas.results.map((x) => x.area) })
})

// ---------- Agenda tim ----------
const AGENDA_KINDS = new Set(['kegiatan', 'pengingat'])
const AGENDA_REPEATS = new Set(['none', 'daily', 'weekly', 'monthly'])
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)
app.get('/agenda', async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM agenda ORDER BY start_date, start_time').all<AgendaItem>()
  const settings = await getSettings(c.env.DB)
  const users = await c.env.DB.prepare('SELECT name FROM users WHERE active = 1 ORDER BY name').all<{ name: string }>()
  const people = [...new Set([...users.results.map((u) => u.name), ...parseTeamCommission(settings.team_commission).members.map((m) => m.name)])]
  return c.json({ items: rows.results, people })
})
function agendaVals(b: Record<string, unknown>, by: string) {
  if (!String(b.title ?? '').trim()) throw new Error('Judul wajib diisi')
  if (!isDate(b.start_date)) throw new Error('Tanggal tidak valid')
  return [
    String(b.title).trim().slice(0, 200),
    str(b.notes),
    AGENDA_KINDS.has(String(b.kind)) ? String(b.kind) : 'kegiatan',
    str(b.category),
    b.start_date,
    /^\d{2}:\d{2}$/.test(String(b.start_time ?? '')) ? String(b.start_time) : null,
    isDate(b.end_date) && String(b.end_date) >= String(b.start_date) ? b.end_date : null,
    str(b.assignee),
    AGENDA_REPEATS.has(String(b.repeat)) ? String(b.repeat) : 'none',
    isDate(b.repeat_until) ? b.repeat_until : null,
    by,
  ]
}
app.post('/agenda', async (c) => {
  try {
    await c.env.DB.prepare('INSERT INTO agenda (title, notes, kind, category, start_date, start_time, end_date, assignee, repeat, repeat_until, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
      .bind(...agendaVals(await c.req.json(), c.get('user').name))
      .run()
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  return c.json({ ok: true })
})
app.put('/agenda/:id', async (c) => {
  try {
    const v = agendaVals(await c.req.json(), '')
    await c.env.DB.prepare('UPDATE agenda SET title=?, notes=?, kind=?, category=?, start_date=?, start_time=?, end_date=?, assignee=?, repeat=?, repeat_until=? WHERE id=?')
      .bind(...v.slice(0, 10), c.req.param('id'))
      .run()
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
  return c.json({ ok: true })
})
app.post('/agenda/:id/done', async (c) => {
  const b = await c.req.json<{ date: string; done: boolean }>()
  if (!isDate(b.date)) return c.json({ error: 'Tanggal tidak valid' }, 400)
  const row = await c.env.DB.prepare('SELECT done FROM agenda WHERE id = ?').bind(c.req.param('id')).first<{ done: string | null }>()
  if (!row) return c.json({ error: 'Agenda tidak ditemukan' }, 404)
  let list: string[] = []
  try {
    list = JSON.parse(row.done ?? '[]')
  } catch {
    list = []
  }
  list = b.done ? [...new Set([...list, b.date])] : list.filter((d) => d !== b.date)
  await c.env.DB.prepare('UPDATE agenda SET done = ? WHERE id = ?').bind(JSON.stringify(list.sort()), c.req.param('id')).run()
  return c.json({ ok: true })
})
app.delete('/agenda/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM agenda WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Helper ----------
async function loadBundle(db: D1Database): Promise<DataBundle> {
  const [settings, products, variants, sales, purchases, purchaseItems, adjustments, boosts, expenses, settlements] = await Promise.all([
    getSettings(db),
    db.prepare('SELECT * FROM products').all(),
    db.prepare('SELECT * FROM variants').all(),
    db.prepare('SELECT * FROM sales').all(),
    db.prepare('SELECT * FROM purchases').all(),
    db.prepare('SELECT * FROM purchase_items').all(),
    db.prepare('SELECT * FROM stock_adjustments').all(),
    db.prepare('SELECT * FROM boosts').all(),
    db.prepare('SELECT * FROM expenses').all(),
    db.prepare('SELECT store, ref_id, kind, fees FROM settlements').all(),
  ])
  return {
    settings,
    products: products.results as never,
    variants: variants.results as never,
    sales: sales.results as never,
    purchases: purchases.results as never,
    purchaseItems: purchaseItems.results as never,
    adjustments: adjustments.results as never,
    boosts: boosts.results as never,
    expenses: expenses.results as never,
    settlements: settlements.results as never,
  }
}

const str = (v: unknown) => (v == null || v === '' ? null : String(v).trim())

// ---------- Dashboard & stok ----------
app.get('/dashboard', async (c) => {
  const b = await loadBundle(c.env.DB)
  const { from, to, store } = c.req.query()
  return c.json(buildDashboard(b, from || undefined, to || undefined, store || undefined))
})

app.get('/stock', async (c) => c.json(computeStock(await loadBundle(c.env.DB))))

app.post('/stock/opname', async (c) => {
  // body: { date, reason, counts: [{ sku, counted }] } → selisih dicatat sebagai penyesuaian
  const body = await c.req.json<{ date: string; reason?: string; counts: { sku: string; counted: number }[] }>()
  const stock = new Map(computeStock(await loadBundle(c.env.DB)).map((r) => [r.sku, r.onHand]))
  const stmts = body.counts
    .map((x) => ({ sku: x.sku, delta: Math.round(num(x.counted)) - (stock.get(x.sku) ?? 0) }))
    .filter((x) => x.delta !== 0)
    .map((x) =>
      c.env.DB.prepare('INSERT INTO stock_adjustments (adj_date, sku, qty_delta, reason) VALUES (?, ?, ?, ?)').bind(
        body.date,
        x.sku,
        x.delta,
        body.reason || 'Stock opname',
      ),
    )
  if (stmts.length) await runBatched(c.env.DB, stmts)
  return c.json({ adjusted: stmts.length })
})

// ---------- Barang masuk & keluar (scan QR) ----------
app.get('/stock/moves', async (c) => {
  const sku = c.req.query('sku')
  const rows = sku
    ? await c.env.DB.prepare('SELECT * FROM stock_moves WHERE sku = ? ORDER BY id DESC LIMIT 100').bind(sku).all()
    : await c.env.DB.prepare('SELECT * FROM stock_moves ORDER BY id DESC LIMIT 300').all()
  return c.json(rows.results)
})
app.post('/stock/moves', async (c) => {
  // body: { date, kind, note?, items: [{ sku, qty }] }
  const b = await c.req.json<{ date?: string; kind: string; note?: string; items: { sku: string; qty: number }[] }>()
  const k = moveKind(b.kind)
  if (!k || k.value === 'penerimaan') return c.json({ error: 'Jenis tidak dikenali' }, 400)
  const date = isDate(b.date) ? b.date! : new Date().toISOString().slice(0, 10)
  const items = (b.items ?? []).map((x) => ({ sku: String(x.sku), qty: Math.round(num(x.qty)) })).filter((x) => x.sku && x.qty > 0)
  if (!items.length) return c.json({ error: 'Belum ada barang yang discan' }, 400)
  const known = new Set((await c.env.DB.prepare('SELECT sku FROM variants').all<{ sku: string }>()).results.map((r) => r.sku))
  const unknown = items.filter((x) => !known.has(x.sku)).map((x) => x.sku)
  if (unknown.length) return c.json({ error: `SKU tidak dikenal: ${unknown.join(', ')}` }, 400)
  const user = c.get('user').name
  for (const it of items) {
    let adj: number | null = null
    if (k.affectsStock) {
      const r = await c.env.DB.prepare('INSERT INTO stock_adjustments (adj_date, sku, qty_delta, reason) VALUES (?,?,?,?) RETURNING id')
        .bind(date, it.sku, k.direction === 'masuk' ? it.qty : -it.qty, `${k.label}${b.note ? ` · ${b.note}` : ''} (scan ${user})`)
        .first<{ id: number }>()
      adj = r?.id ?? null
    }
    await c.env.DB.prepare('INSERT INTO stock_moves (move_date, sku, qty, direction, kind, note, user_name, adjustment_id) VALUES (?,?,?,?,?,?,?,?)')
      .bind(date, it.sku, it.qty, k.direction, k.value, str(b.note), user, adj)
      .run()
  }
  return c.json({ ok: true, count: items.reduce((a, x) => a + x.qty, 0) })
})
app.delete('/stock/moves/:id', async (c) => {
  const m = await c.env.DB.prepare('SELECT * FROM stock_moves WHERE id = ?').bind(c.req.param('id')).first<{ adjustment_id: number | null; kind: string; ref: string | null; sku: string; qty: number }>()
  if (!m) return c.json({ error: 'Catatan tidak ditemukan' }, 404)
  if (m.kind === 'penerimaan' && m.ref && !m.adjustment_id) {
    // scan penerimaan yang dibatalkan mengurangi "sudah diterima" di batchnya, selama batch belum ditutup
    const p = await c.env.DB.prepare('SELECT id, status FROM purchases WHERE name = ?').bind(m.ref).first<{ id: number; status: string }>()
    if (p?.status === 'Tiba') return c.json({ error: 'Batch ini sudah ditutup. Koreksi jumlahnya lewat Stock opname.' }, 400)
    if (p) {
      let left = m.qty
      const rows = (await c.env.DB.prepare('SELECT id, received_qty FROM purchase_items WHERE purchase_id = ? AND sku = ? ORDER BY id DESC').bind(p.id, m.sku).all<{ id: number; received_qty: number }>()).results
      for (const r of rows) {
        const take = Math.min(left, r.received_qty)
        if (take <= 0) continue
        await c.env.DB.prepare('UPDATE purchase_items SET received_qty = received_qty - ? WHERE id = ?').bind(take, r.id).run()
        left -= take
      }
    }
  }
  if (m.adjustment_id) await c.env.DB.prepare('DELETE FROM stock_adjustments WHERE id = ?').bind(m.adjustment_id).run()
  await c.env.DB.prepare('DELETE FROM stock_moves WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})
app.post('/stock/receive', async (c) => {
  // penerimaan batch (boleh bertahap):
  // { purchase_id, date, items: [{ sku, qty }], close } → hasil scan ditambahkan ke "sudah diterima".
  // close = true: batch ditutup (status Tiba); selisih total diterima vs isi batch dicatat sebagai penyesuaian.
  const b = await c.req.json<{ purchase_id: number; date?: string; items: { sku: string; qty: number }[]; close?: boolean }>()
  const db = c.env.DB
  const p = await db.prepare('SELECT * FROM purchases WHERE id = ?').bind(b.purchase_id).first<{ id: number; name: string; status: string; arrival_date: string | null }>()
  if (!p) return c.json({ error: 'Batch tidak ditemukan' }, 404)
  if (p.status === 'Tiba') return c.json({ error: `${p.name} sudah tercatat tiba` }, 400)
  const date = isDate(b.date) ? b.date! : new Date().toISOString().slice(0, 10)
  const rows = (await db.prepare('SELECT id, sku, qty, received_qty FROM purchase_items WHERE purchase_id = ? ORDER BY id').bind(p.id).all<{ id: number; sku: string; qty: number; received_qty: number }>()).results
  const got = new Map<string, number>()
  for (const it of b.items ?? []) if (it.sku && num(it.qty) > 0) got.set(String(it.sku), (got.get(String(it.sku)) ?? 0) + Math.round(num(it.qty)))
  if (!b.close && ![...got.values()].some((v) => v > 0)) return c.json({ error: 'Belum ada barang yang discan' }, 400)
  const user = c.get('user').name
  const addMove = (sku: string, qty: number, note: string | null, adj: number | null) =>
    db.prepare('INSERT INTO stock_moves (move_date, sku, qty, direction, kind, ref, note, user_name, adjustment_id) VALUES (?,?,?,?,?,?,?,?,?)').bind(date, sku, qty, 'masuk', 'penerimaan', p.name, note, user, adj).run()
  const addAdj = async (sku: string, delta: number, reason: string) =>
    (await db.prepare('INSERT INTO stock_adjustments (adj_date, sku, qty_delta, reason) VALUES (?,?,?,?) RETURNING id').bind(date, sku, delta, reason).first<{ id: number }>())?.id ?? null
  const extras: { sku: string; qty: number }[] = []
  for (const [sku, qty] of got) {
    const mine = rows.filter((r) => r.sku === sku)
    if (!mine.length) {
      // barang yang tidak ada di isi batch langsung masuk stok sebagai penyesuaian
      extras.push({ sku, qty })
      await addMove(sku, qty, 'tidak ada di isi batch', await addAdj(sku, qty, `Barang di luar isi ${p.name} (scan ${user})`))
      continue
    }
    // isi ke baris batch secara berurutan; kelebihan masuk ke baris terakhir
    let left = qty
    for (const [i, r] of mine.entries()) {
      const room = i === mine.length - 1 ? left : Math.max(0, Math.min(left, r.qty - r.received_qty))
      if (room <= 0) continue
      r.received_qty += room
      left -= room
      await db.prepare('UPDATE purchase_items SET received_qty = ? WHERE id = ?').bind(r.received_qty, r.id).run()
      if (left <= 0) break
    }
    await addMove(sku, qty, null, null)
  }
  const diffs: { sku: string; diff: number }[] = []
  if (b.close) {
    const bySku = new Map<string, { qty: number; got: number }>()
    for (const r of rows) {
      const x = bySku.get(r.sku) ?? { qty: 0, got: 0 }
      x.qty += r.qty
      x.got += r.received_qty
      bySku.set(r.sku, x)
    }
    for (const [sku, x] of bySku) {
      const diff = x.got - x.qty
      if (!diff) continue
      diffs.push({ sku, diff })
      await addMove(sku, 0, `ditutup: isi batch ${x.qty}, diterima ${x.got}, selisih ${diff > 0 ? '+' : ''}${diff}`, await addAdj(sku, diff, `Selisih penerimaan ${p.name} (ditutup oleh ${user})`))
    }
    await db.prepare("UPDATE purchases SET status = 'Tiba', arrival_date = ? WHERE id = ?").bind(date, p.id).run()
  } else {
    await db.prepare("UPDATE purchases SET status = 'Tiba sebagian', arrival_date = COALESCE(arrival_date, ?) WHERE id = ?").bind(date, p.id).run()
  }
  const remaining = rows.reduce((a, r) => a + Math.max(0, r.qty - r.received_qty), 0)
  return c.json({ ok: true, closed: !!b.close, diffs, extras, remaining })
})

app.get('/stock/adjustments', async (c) =>
  c.json((await c.env.DB.prepare('SELECT * FROM stock_adjustments ORDER BY adj_date DESC, id DESC').all()).results),
)
app.post('/stock/adjustments', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  await c.env.DB.prepare('INSERT INTO stock_adjustments (adj_date, sku, qty_delta, reason) VALUES (?, ?, ?, ?)')
    .bind(b.adj_date, b.sku, Math.round(num(b.qty_delta)), str(b.reason))
    .run()
  return c.json({ ok: true })
})
app.delete('/stock/adjustments/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM stock_adjustments WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Pengaturan & toko ----------
app.get('/settings', async (c) => {
  const stores = await c.env.DB.prepare('SELECT * FROM stores ORDER BY id').all()
  const all = await getSettings(c.env.DB)
  // catatan KPI hanya untuk owner; persen komisi per orang juga hanya untuk owner (staf cukup tahu nama tim)
  const owner = await ownerOk(c)
  const settings: Record<string, string> = Object.fromEntries(Object.entries(all).filter(([k]) => !k.startsWith('kpi_') && (owner || k !== 'team_commission')))
  settings.team_names = JSON.stringify(parseTeamCommission(all.team_commission).members.map((m) => m.name))
  return c.json({ settings, stores: stores.results })
})
// kunci yang boleh diubah staf (skenario proyeksi & restock); selebihnya hanya owner
const STAFF_SETTING_KEYS = new Set(['projection', 'restock'])
app.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>()
  if (Object.keys(body).some((k) => !STAFF_SETTING_KEYS.has(k)) && !(await ownerOk(c))) {
    return c.json({ error: 'Pengaturan hanya bisa diubah owner. Buka kunci dengan kata sandi owner.' }, 403)
  }
  if (Object.keys(body).some((k) => k.startsWith('kpi_'))) return c.json({ error: 'Gunakan menu KPI' }, 400)
  await runBatched(
    c.env.DB,
    Object.entries(body).map(([k, v]) =>
      c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(k, String(v)),
    ),
  )
  return c.json({ ok: true })
})
app.post('/stores', async (c) => {
  const b = await c.req.json<{ name: string; channel?: string }>()
  await c.env.DB.prepare('INSERT INTO stores (name, channel) VALUES (?, ?)').bind(b.name.trim(), b.channel || 'TikTok Shop').run()
  return c.json({ ok: true })
})
app.delete('/stores/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM stores WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Produk & varian ----------
app.get('/products', async (c) => {
  const [p, v] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM products ORDER BY code').all(),
    c.env.DB.prepare('SELECT * FROM variants ORDER BY sku').all(),
  ])
  return c.json({ products: p.results, variants: v.results })
})
app.post('/products', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  await c.env.DB.prepare(
    `INSERT INTO products (code, name, category, reference, status, notes) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, category = excluded.category, reference = excluded.reference,
     status = excluded.status, notes = excluded.notes`,
  )
    .bind(String(b.code).trim(), String(b.name).trim(), b.category || 'Tas', str(b.reference), b.status || 'Aktif', str(b.notes))
    .run()
  return c.json({ ok: true })
})
app.delete('/products/:code', async (c) => {
  const code = c.req.param('code')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM variants WHERE product_code = ?').bind(code),
    c.env.DB.prepare('DELETE FROM products WHERE code = ?').bind(code),
  ])
  return c.json({ ok: true })
})
app.post('/variants', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  await c.env.DB.prepare(
    `INSERT INTO variants (sku, product_code, color, price, active) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(sku) DO UPDATE SET product_code = excluded.product_code, color = excluded.color, price = excluded.price, active = excluded.active`,
  )
    .bind(String(b.sku).trim(), b.product_code, String(b.color).trim(), b.price === '' || b.price == null ? null : num(b.price), b.active === 0 ? 0 : 1)
    .run()
  return c.json({ ok: true })
})
app.delete('/variants/:sku', async (c) => {
  await c.env.DB.prepare('DELETE FROM variants WHERE sku = ?').bind(c.req.param('sku')).run()
  return c.json({ ok: true })
})

// ---------- Pemetaan SKU TikTok ----------
app.get('/sku-map', async (c) => {
  const [map, unmapped] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM sku_map ORDER BY sku').all(),
    c.env.DB.prepare(
      `SELECT platform_sku_id, product_name, variation, store, COUNT(*) AS lines, SUM(qty) AS qty
       FROM sales WHERE sku IS NULL GROUP BY platform_sku_id, product_name, variation, store ORDER BY lines DESC`,
    ).all(),
  ])
  return c.json({ map: map.results, unmapped: unmapped.results })
})
// Impor katalog sekaligus (produk, varian, pemetaan SKU TikTok) dari file Excel; data yang sudah ada diperbarui.
app.post('/catalog/import', async (c) => {
  const b = await c.req.json<{
    products?: { code: string; name: string; category: string; reference?: string | null; status?: string; notes?: string | null }[]
    variants?: { sku: string; product_code: string; color: string; price?: number | null; active?: number }[]
    skuMap?: { platform_sku_id: string; sku: string; product_name?: string | null; variation?: string | null }[]
  }>()
  const db = c.env.DB
  const products = (b.products ?? []).filter((p) => p.code && p.name)
  const variants = (b.variants ?? []).filter((v) => v.sku && v.product_code)
  const skuMap = (b.skuMap ?? []).filter((m) => /^\d+$/.test(String(m.platform_sku_id)) && m.sku)
  const known = new Set([...(await db.prepare('SELECT code FROM products').all<{ code: string }>()).results.map((r) => r.code), ...products.map((p) => p.code)])
  const badVariant = variants.filter((v) => !known.has(v.product_code)).map((v) => v.sku)
  if (badVariant.length) return c.json({ error: `Model belum ada untuk varian: ${badVariant.slice(0, 5).join(', ')}` }, 400)
  const skus = new Set([...(await db.prepare('SELECT sku FROM variants').all<{ sku: string }>()).results.map((r) => r.sku), ...variants.map((v) => v.sku)])
  const badMap = skuMap.filter((m) => !skus.has(m.sku)).map((m) => m.sku)
  if (badMap.length) return c.json({ error: `SKU portal tidak dikenal di pemetaan: ${[...new Set(badMap)].slice(0, 5).join(', ')}` }, 400)
  await runBatched(db, [
    ...products.map((p) =>
      db
        .prepare(
          `INSERT INTO products (code, name, category, reference, status, notes) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET name = excluded.name, category = excluded.category, reference = excluded.reference, status = excluded.status, notes = excluded.notes`,
        )
        .bind(p.code.trim(), p.name.trim(), p.category || 'Tas', str(p.reference), p.status || 'Aktif', str(p.notes)),
    ),
    ...variants.map((v) =>
      db
        .prepare(
          `INSERT INTO variants (sku, product_code, color, price, active) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(sku) DO UPDATE SET product_code = excluded.product_code, color = excluded.color, price = excluded.price, active = excluded.active`,
        )
        .bind(v.sku.trim(), v.product_code, String(v.color ?? '').trim(), v.price == null || !Number.isFinite(Number(v.price)) ? null : Number(v.price), v.active === 0 ? 0 : 1),
    ),
    ...skuMap.flatMap((m) => [
      db
        .prepare(
          `INSERT INTO sku_map (platform_sku_id, sku, product_name, variation) VALUES (?, ?, ?, ?)
           ON CONFLICT(platform_sku_id) DO UPDATE SET sku = excluded.sku, product_name = excluded.product_name, variation = excluded.variation`,
        )
        .bind(String(m.platform_sku_id), m.sku, str(m.product_name), str(m.variation)),
      db.prepare('UPDATE sales SET sku = ? WHERE platform_sku_id = ?').bind(m.sku, String(m.platform_sku_id)),
    ]),
  ])
  return c.json({ ok: true, products: products.length, variants: variants.length, skuMap: skuMap.length })
})

app.post('/sku-map', async (c) => {
  const b = await c.req.json<{ platform_sku_id: string; sku: string; product_name?: string; variation?: string }>()
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO sku_map (platform_sku_id, sku, product_name, variation) VALUES (?, ?, ?, ?)
       ON CONFLICT(platform_sku_id) DO UPDATE SET sku = excluded.sku`,
    ).bind(b.platform_sku_id, b.sku, str(b.product_name), str(b.variation)),
    c.env.DB.prepare('UPDATE sales SET sku = ? WHERE platform_sku_id = ?').bind(b.sku, b.platform_sku_id),
  ])
  return c.json({ ok: true })
})

// ---------- Penjualan ----------
app.get('/sales', async (c) => {
  const { from, to, store, status, q } = c.req.query()
  const where: string[] = []
  const args: unknown[] = []
  if (from) (where.push('substr(order_date,1,7) >= ?'), args.push(from))
  if (to) (where.push('substr(order_date,1,7) <= ?'), args.push(to))
  if (store) (where.push('store = ?'), args.push(store))
  if (status) (where.push('status = ?'), args.push(status))
  if (q) (where.push('(order_id LIKE ? OR sku LIKE ? OR product_name LIKE ?)'), args.push(`%${q}%`, `%${q}%`, `%${q}%`))
  const sql = `SELECT * FROM sales ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY order_date DESC, id DESC LIMIT 2000`
  return c.json((await c.env.DB.prepare(sql).bind(...args).all()).results)
})

app.post('/sales', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  const qty = Math.round(num(b.qty))
  const status = String(b.status || 'Normal')
  const ret = status === 'Retur' ? Math.round(num(b.return_qty, qty)) : 0
  const cancel = status === 'Batal' ? qty : 0
  const orderId = str(b.order_id) ?? `M-${Date.now()}`
  await c.env.DB.prepare(
    `INSERT INTO sales (source, store, order_id, line_key, order_date, sku, qty, return_qty, cancel_qty, unit_price, status, notes)
     VALUES ('manual', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(b.store, orderId, String(b.sku), b.order_date, b.sku, qty, ret, cancel, num(b.unit_price), status, str(b.notes))
    .run()
  return c.json({ ok: true })
})

app.put('/sales/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  const qty = Math.round(num(b.qty))
  const status = String(b.status || 'Normal')
  const ret = status === 'Retur' ? Math.round(num(b.return_qty, qty)) : 0
  const cancel = status === 'Batal' ? qty : 0
  await c.env.DB.prepare(
    `UPDATE sales SET store = ?, order_date = ?, sku = ?, qty = ?, return_qty = ?, cancel_qty = ?, unit_price = ?, status = ?, notes = ? WHERE id = ?`,
  )
    .bind(b.store, b.order_date, b.sku, qty, ret, cancel, num(b.unit_price), status, str(b.notes), c.req.param('id'))
    .run()
  return c.json({ ok: true })
})

app.delete('/sales/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM sales WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

app.post('/sales/import', async (c) => {
  const body = await c.req.json<{ store: string; lines: ImportedSaleLine[] }>()
  if (!body.store) return c.json({ error: 'Pilih toko terlebih dahulu' }, 400)
  const [map, variants] = await Promise.all([
    c.env.DB.prepare('SELECT platform_sku_id, sku FROM sku_map').all<{ platform_sku_id: string; sku: string }>(),
    c.env.DB.prepare('SELECT sku FROM variants').all<{ sku: string }>(),
  ])
  const skuOf = new Map(map.results.map((r) => [r.platform_sku_id, r.sku]))
  const known = new Set(variants.results.map((r) => r.sku))
  const before = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM sales WHERE store = ?').bind(body.store).first<{ n: number }>()
  const stmts = body.lines.map((l) => {
    const sku = (l.platform_sku_id && skuOf.get(l.platform_sku_id)) || (l.seller_sku && known.has(l.seller_sku) ? l.seller_sku : null)
    return c.env.DB.prepare(
      `INSERT INTO sales (source, store, order_id, line_key, order_date, sku, platform_sku_id, product_name, variation, qty, return_qty, cancel_qty, unit_price, status, weight_kg)
       VALUES ('tiktok', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(store, order_id, line_key) DO UPDATE SET
         order_date = excluded.order_date, sku = COALESCE(sales.sku, excluded.sku), qty = excluded.qty,
         return_qty = excluded.return_qty, cancel_qty = excluded.cancel_qty, unit_price = excluded.unit_price,
         status = excluded.status, weight_kg = excluded.weight_kg, product_name = excluded.product_name, variation = excluded.variation`,
    ).bind(
      body.store,
      l.order_id,
      l.line_key,
      l.order_date,
      sku,
      l.platform_sku_id,
      l.product_name,
      l.variation,
      l.qty,
      l.return_qty,
      l.cancel_qty,
      l.unit_price,
      l.status,
      l.weight_kg,
    )
  })
  await runBatched(c.env.DB, stmts)
  const after = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM sales WHERE store = ?').bind(body.store).first<{ n: number }>()
  const unmapped = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM sales WHERE sku IS NULL').first<{ n: number }>()
  return c.json({
    received: body.lines.length,
    inserted: (after?.n ?? 0) - (before?.n ?? 0),
    updated: body.lines.length - ((after?.n ?? 0) - (before?.n ?? 0)),
    unmapped: unmapped?.n ?? 0,
  })
})

// ---------- Pembelian / impor ----------
app.get('/purchases', async (c) => {
  const [p, i] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM purchases ORDER BY order_date DESC, id DESC').all(),
    c.env.DB.prepare('SELECT * FROM purchase_items ORDER BY id').all(),
  ])
  return c.json({ purchases: p.results, items: i.results })
})

async function savePurchase(db: D1Database, b: Record<string, unknown>, id?: number) {
  const vals = [
    String(b.name).trim(),
    b.order_date,
    str(b.arrival_date),
    b.status || 'Dipesan',
    str(b.supplier),
    num(b.exchange_rate),
    num(b.cargo_cost),
    num(b.other_cost),
    str(b.notes),
  ]
  let pid = id
  // jumlah yang sudah diterima lewat scan dipertahankan saat batch diubah
  const received = new Map<string, number>()
  if (pid) {
    for (const r of (await db.prepare('SELECT sku, received_qty FROM purchase_items WHERE purchase_id = ?').bind(pid).all<{ sku: string; received_qty: number }>()).results)
      received.set(r.sku, (received.get(r.sku) ?? 0) + (r.received_qty ?? 0))
    await db
      .prepare('UPDATE purchases SET name=?, order_date=?, arrival_date=?, status=?, supplier=?, exchange_rate=?, cargo_cost=?, other_cost=?, notes=? WHERE id=?')
      .bind(...vals, pid)
      .run()
    await db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').bind(pid).run()
  } else {
    const r = await db
      .prepare('INSERT INTO purchases (name, order_date, arrival_date, status, supplier, exchange_rate, cargo_cost, other_cost, notes) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
      .bind(...vals)
      .first<{ id: number }>()
    pid = r!.id
  }
  const items = (b.items as { sku: string; qty: number; price_cny: number | null }[]) ?? []
  await runBatched(
    db,
    items
      .filter((x) => x.sku && num(x.qty) > 0)
      .map((x) => {
        const got = received.get(x.sku) ?? 0
        received.delete(x.sku) // satu SKU di beberapa baris: jumlah diterima ditaruh di baris pertama
        return db
          .prepare('INSERT INTO purchase_items (purchase_id, sku, qty, price_cny, received_qty) VALUES (?, ?, ?, ?, ?)')
          .bind(pid, x.sku, Math.round(num(x.qty)), x.price_cny === null || (x.price_cny as unknown) === '' ? null : num(x.price_cny), got)
      }),
  )
  return pid
}
app.post('/purchases', async (c) => c.json({ id: await savePurchase(c.env.DB, await c.req.json()) }))
app.put('/purchases/:id', async (c) => c.json({ id: await savePurchase(c.env.DB, await c.req.json(), Number(c.req.param('id'))) }))
app.delete('/purchases/:id', async (c) => {
  const id = c.req.param('id')
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM purchases WHERE id = ?').bind(id),
  ])
  return c.json({ ok: true })
})

// ---------- Boost ----------
app.get('/boosts', async (c) => c.json((await c.env.DB.prepare('SELECT * FROM boosts ORDER BY boost_date DESC, id DESC').all()).results))
const boostVals = (b: Record<string, unknown>) => [
  b.boost_date,
  b.store,
  b.kind || 'LIVE',
  str(b.title),
  str(b.status),
  num(b.budget),
  num(b.coupon),
  num(b.apple_fee),
  b.purchases === '' || b.purchases == null ? null : Math.round(num(b.purchases)),
  b.viewers === '' || b.viewers == null ? null : Math.round(num(b.viewers)),
  b.views === '' || b.views == null ? null : Math.round(num(b.views)),
  str(b.notes),
]
app.post('/boosts', async (c) => {
  await c.env.DB.prepare(
    'INSERT INTO boosts (boost_date, store, kind, title, status, budget, coupon, apple_fee, purchases, viewers, views, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(...boostVals(await c.req.json()))
    .run()
  return c.json({ ok: true })
})
app.put('/boosts/:id', async (c) => {
  await c.env.DB.prepare(
    'UPDATE boosts SET boost_date=?, store=?, kind=?, title=?, status=?, budget=?, coupon=?, apple_fee=?, purchases=?, viewers=?, views=?, notes=? WHERE id=?',
  )
    .bind(...boostVals(await c.req.json()), c.req.param('id'))
    .run()
  return c.json({ ok: true })
})
app.delete('/boosts/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM boosts WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Biaya ----------
// gaji & komisi hanya untuk owner: disembunyikan dari daftar dan tidak bisa diubah staf
const PRIVATE_CATS = new Set(PRIVATE_EXPENSE_CATEGORIES)
const PRIVATE_MSG = 'Gaji dan komisi hanya bisa dilihat dan diubah owner.'
const privateRow = async (db: D1Database, id: string) => PRIVATE_CATS.has((await db.prepare('SELECT category FROM expenses WHERE id = ?').bind(id).first<{ category: string }>())?.category ?? '')
app.get('/expenses', async (c) => {
  const rows = (await c.env.DB.prepare('SELECT * FROM expenses ORDER BY exp_date DESC, id DESC').all<{ category: string }>()).results
  return c.json((await ownerOk(c)) ? rows : rows.filter((r) => !PRIVATE_CATS.has(r.category)))
})
const expVals = (b: Record<string, unknown>) => [b.exp_date, b.category, str(b.description), num(b.amount), b.classification || 'Tetap', b.cash_only ? 1 : 0]
app.post('/expenses', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  if (PRIVATE_CATS.has(String(b.category)) && !(await ownerOk(c))) return c.json({ error: PRIVATE_MSG }, 403)
  await c.env.DB.prepare('INSERT INTO expenses (exp_date, category, description, amount, classification, cash_only) VALUES (?,?,?,?,?,?)')
    .bind(...expVals(b))
    .run()
  return c.json({ ok: true })
})
app.put('/expenses/:id', async (c) => {
  const b = await c.req.json<Record<string, unknown>>()
  if ((PRIVATE_CATS.has(String(b.category)) || (await privateRow(c.env.DB, c.req.param('id')))) && !(await ownerOk(c))) return c.json({ error: PRIVATE_MSG }, 403)
  await c.env.DB.prepare('UPDATE expenses SET exp_date=?, category=?, description=?, amount=?, classification=?, cash_only=? WHERE id=?')
    .bind(...expVals(b), c.req.param('id'))
    .run()
  return c.json({ ok: true })
})
app.delete('/expenses/:id', async (c) => {
  if ((await privateRow(c.env.DB, c.req.param('id'))) && !(await ownerOk(c))) return c.json({ error: PRIVATE_MSG }, 403)
  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Settlement / pencairan TikTok ----------
type SettlementRow = {
  store: string
  ref_id: string
  kind: string
  settled_at: string | null
  order_created_at: string | null
  revenue: number
  fees: number
  amount: number
  details: string | null
}
app.post('/settlements/import', async (c) => {
  const body = await c.req.json<{ store: string; lines: Omit<SettlementRow, 'store' | 'details'> & { details: Record<string, number> }[] }>()
  if (!body.store) return c.json({ error: 'Pilih toko terlebih dahulu' }, 400)
  const lines = body.lines as unknown as (Omit<SettlementRow, 'details' | 'store'> & { details: Record<string, number> })[]
  await runBatched(
    c.env.DB,
    lines.map((l) =>
      c.env.DB.prepare(
        `INSERT INTO settlements (store, ref_id, kind, settled_at, order_created_at, revenue, fees, amount, details) VALUES (?,?,?,?,?,?,?,?,?)
         ON CONFLICT(store, ref_id, kind) DO UPDATE SET settled_at=excluded.settled_at, order_created_at=excluded.order_created_at,
         revenue=excluded.revenue, fees=excluded.fees, amount=excluded.amount, details=excluded.details`,
      ).bind(body.store, l.ref_id, l.kind || 'Order', l.settled_at, l.order_created_at, num(l.revenue), num(l.fees), num(l.amount), JSON.stringify(l.details ?? {})),
    ),
  )
  return c.json({ ok: true, saved: lines.length })
})
app.delete('/settlements', async (c) => {
  const store = c.req.query('store')
  if (store) await c.env.DB.prepare('DELETE FROM settlements WHERE store = ?').bind(store).run()
  else await c.env.DB.prepare('DELETE FROM settlements').run()
  return c.json({ ok: true })
})
app.get('/settlements/report', async (c) => {
  const [st, sales, settings] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM settlements').all<SettlementRow>(),
    c.env.DB.prepare('SELECT * FROM sales').all<Record<string, unknown>>(),
    getSettings(c.env.DB),
  ])
  const rows = st.results
  const sum = (f: (r: SettlementRow) => number, rr = rows) => rr.reduce((a, r) => a + f(r), 0)
  const isOrder = (k: string) => /order|pesanan/i.test(k)
  // per bulan pencairan
  const byMonth = new Map<string, { month: string; count: number; revenue: number; fees: number; amount: number }>()
  for (const r of rows) {
    const m = (r.settled_at ?? r.order_created_at ?? '').slice(0, 7) || 'Tanpa tanggal'
    const x = byMonth.get(m) ?? { month: m, count: 0, revenue: 0, fees: 0, amount: 0 }
    x.count++
    x.revenue += r.revenue
    x.fees += r.fees
    x.amount += r.amount
    byMonth.set(m, x)
  }
  // komponen
  const comp = new Map<string, number>()
  for (const r of rows) for (const [k, v] of Object.entries(JSON.parse(r.details || '{}') as Record<string, number>)) comp.set(k, (comp.get(k) ?? 0) + v)
  // perkiraan vs aktual untuk pesanan yang ada di kedua data
  const commission = num(settings.platform_commission_pct, 0.08) + num(settings.dynamic_commission_pct, 0.055)
  const perOrder = num(settings.order_processing_fee, 1250)
  const heavyFee = num(settings.heavy_parcel_fee, 10000)
  const heavyKg = num(settings.heavy_parcel_threshold_kg, 0.3)
  const heavyShare = num(settings.heavy_parcel_share_fallback, 0.082)
  const orders = new Map<string, { store: string; order_id: string; date: string; omzet: number; net: number; weight: number | null }>()
  for (const s of sales.results) {
    const key = `${s.store}|${s.order_id}`
    const net = Number(s.qty) - Number(s.return_qty) - Number(s.cancel_qty)
    const o = orders.get(key) ?? { store: String(s.store), order_id: String(s.order_id), date: String(s.order_date), omzet: 0, net: 0, weight: null }
    o.omzet += net * Number(s.unit_price)
    o.net += net
    if (s.weight_kg != null) o.weight = Math.max(o.weight ?? 0, Number(s.weight_kg))
    orders.set(key, o)
  }
  const settledKeys = new Map<string, SettlementRow>()
  for (const r of rows) if (isOrder(r.kind)) settledKeys.set(`${r.store}|${r.ref_id}`, r)
  let matched = 0
  let estFees = 0
  let actFees = 0
  let matchedOmzet = 0
  for (const [k, o] of orders) {
    const r = settledKeys.get(k)
    if (!r || o.net <= 0) continue
    matched++
    matchedOmzet += o.omzet
    actFees += r.fees
    estFees += o.omzet * commission + perOrder + (o.weight == null ? heavyFee * heavyShare : o.weight > heavyKg ? heavyFee : 0)
  }
  // pesanan terjual yang belum ada di laporan (dalam periode laporan per toko)
  const startOf = new Map<string, string>()
  const endOf = new Map<string, string>()
  for (const r of rows) {
    const d = (r.order_created_at ?? r.settled_at)?.slice(0, 10)
    if (!d) continue
    if (!startOf.has(r.store) || d < startOf.get(r.store)!) startOf.set(r.store, d)
    if (!endOf.has(r.store) || d > endOf.get(r.store)!) endOf.set(r.store, d)
  }
  // belum cair = terjual tapi belum ada di laporan; dipisah antara yang masih dalam periode laporan
  // dan yang dibuat setelah laporan terakhir (laporannya belum diunggah)
  const open = [...orders.values()].filter((o) => o.net > 0 && !settledKeys.has(`${o.store}|${o.order_id}`))
  const day = (o: { date: string }) => o.date.slice(0, 10)
  const inPeriod = open.filter((o) => startOf.has(o.store) && day(o) >= startOf.get(o.store)! && day(o) <= endOf.get(o.store)!)
  const afterPeriod = open.filter((o) => !endOf.has(o.store) || day(o) > endOf.get(o.store)!)
  const unsettled = [...inPeriod, ...afterPeriod].sort((a, b) => b.date.localeCompare(a.date))
  const orderRows = rows.filter((r) => isOrder(r.kind))
  return c.json({
    totals: {
      lines: rows.length,
      orders: orderRows.length,
      revenue: sum((r) => r.revenue),
      fees: sum((r) => r.fees),
      amount: sum((r) => r.amount),
      adjustments: sum((r) => r.amount, rows.filter((r) => !isOrder(r.kind))),
      stores: [...new Set(rows.map((r) => r.store))],
      from: [...rows.map((r) => r.settled_at ?? r.order_created_at).filter(Boolean)].sort()[0] ?? null,
      to: [...rows.map((r) => r.settled_at ?? r.order_created_at).filter(Boolean)].sort().pop() ?? null,
    },
    byMonth: [...byMonth.values()].sort((a, b) => a.month.localeCompare(b.month)),
    components: [...comp.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    comparison: { matched, matchedOmzet, estFees, actFees },
    unsettled: {
      count: unsettled.length,
      omzet: unsettled.reduce((a, o) => a + o.omzet, 0),
      items: unsettled.slice(0, 50),
      afterCount: afterPeriod.length,
      afterOmzet: afterPeriod.reduce((a, o) => a + o.omzet, 0),
      lastReportDate: [...endOf.values()].sort().pop() ?? null,
    },
  })
})

// ---------- Proyeksi arus kas: angka dasar dari data ----------
app.get('/projection/base', async (c) => {
  const b = await loadBundle(c.env.DB)
  const d = buildDashboard(b)
  const s = b.settings
  const months = d.monthly
  const pcs = months.reduce((a, r) => a + r.pcsNet, 0)
  const hpp = months.reduce((a, r) => a + r.hpp, 0)
  const orders = months.reduce((a, r) => a + r.orders, 0)
  const varExp = months.reduce((a, r) => a + r.variableExpenses, 0)
  const activeMonths = months.filter((r) => r.pcsNet > 0)
  // porsi pesanan paket berat dari data berat yang tersedia
  const w = new Map<string, number>()
  for (const x of b.sales) if (x.weight_kg != null) w.set(`${x.store}|${x.order_id}`, Math.max(w.get(`${x.store}|${x.order_id}`) ?? 0, x.weight_kg))
  const heavyShare = w.size ? [...w.values()].filter((v) => v > num(s.heavy_parcel_threshold_kg, 0.3)).length / w.size : num(s.heavy_parcel_share_fallback, 0.082)
  const lastFixed = [...months].reverse().find((r) => r.fixedCosts > 0)
  // jika ada data settlement, pakai potongan efektif asli (persen dari omzet pesanan yang sudah cair)
  const actualOrders = months.reduce((a, r) => a + r.actualFeeOrders, 0)
  let actualFeePct: number | null = null
  if (actualOrders >= 20) {
    const settledKeys = new Set((b.settlements ?? []).filter((x) => /order|pesanan/i.test(x.kind)).map((x) => `${x.store}|${x.ref_id}`))
    const feeSum = (b.settlements ?? []).filter((x) => /order|pesanan/i.test(x.kind)).reduce((a, x) => a + x.fees, 0)
    const omzetSettled = b.sales
      .filter((x) => settledKeys.has(`${x.store}|${x.order_id}`))
      .reduce((a, x) => a + (x.qty - x.return_qty - x.cancel_qty) * x.unit_price, 0)
    if (omzetSettled > 0) actualFeePct = feeSum / omzetSettled
  }
  const boostMonths = months.filter((r) => r.omzetNet > 0)
  const pcsPerOrder = orders ? pcs / orders : 1
  // komisi tim per pcs: dari pengaturan persen per orang bila ada, selain itu rata-rata biaya variabel historis
  const teamCommissionPerPcs = () => {
    const tp = teamPct(parseTeamCommission(s.team_commission))
    if (!tp) return pcs ? varExp / pcs : 0
    const feePct = actualFeePct ?? num(s.platform_commission_pct, 0.08) + num(s.dynamic_commission_pct, 0.055)
    const perOrder = actualFeePct != null ? 0 : num(s.order_processing_fee, 1250) + num(s.heavy_parcel_fee, 10000) * heavyShare
    return Math.max(0, tp * (d.kpi.avgPrice * (1 - feePct) - perOrder / (pcsPerOrder || 1)))
  }
  return c.json({
    avgPrice: d.kpi.avgPrice,
    landedCost: pcs ? hpp / pcs : num(s.fallback_landed_cost, 120000),
    commissionPct: actualFeePct ?? num(s.platform_commission_pct, 0.08) + num(s.dynamic_commission_pct, 0.055),
    perOrderFee: actualFeePct != null ? 0 : num(s.order_processing_fee, 1250) + num(s.heavy_parcel_fee, 10000) * heavyShare,
    feeSource: actualFeePct != null ? 'settlement' : 'tarif',
    teamCommissionPerPcs: teamCommissionPerPcs(),
    pcsPerOrder: orders ? pcs / orders : 1,
    openingStock: d.kpi.stockUnits,
    avgPcs: d.period.activeMonths ? pcs / d.period.activeMonths : 0,
    avgPcsSelling: activeMonths.length ? pcs / activeMonths.length : 0,
    bestPcs: Math.max(0, ...months.map((r) => r.pcsNet)),
    plannedFixed: num(s.planned_fixed_cost, 0) || null,
    lastFixed: lastFixed ? { month: lastFixed.month, amount: lastFixed.fixedCosts } : null,
    avgBoost: boostMonths.length ? boostMonths.reduce((a, r) => a + r.boost, 0) / boostMonths.length : 0,
    contributionPct: d.kpi.contributionPct,
    saved: s.projection ? JSON.parse(s.projection) : null,
  })
})

// ---------- Komisi tim per orang per bulan ----------
app.get('/team-commission', async (c) => {
  const b = await loadBundle(c.env.DB)
  const team = parseTeamCommission(b.settings.team_commission)
  const rows = computeMonthly(b)
    .filter((r) => r.month >= team.start)
    .map((r) => ({ month: r.month, netRevenue: r.omzetNet - r.platformFees, total: r.teamCommission, by: r.teamCommissionBy }))
    .reverse()
  const ignored = b.expenses.filter((x) => team.members.length && x.category === 'Komisi' && x.exp_date.slice(0, 7) >= team.start).length
  return c.json({ team, rows, ignored })
})

// ---------- KPI staf (khusus owner) ----------
async function kpiContexts(db: D1Database, months: string[], records: Record<string, KpiMonthRecord>) {
  const [b, liveRows] = await Promise.all([loadBundle(db), db.prepare('SELECT * FROM live_sessions').all()])
  const monthly = new Map(computeMonthly(b).map((r) => [r.month, r]))
  const team = parseTeamCommission(b.settings.team_commission)
  const proj = b.settings.projection ? (JSON.parse(b.settings.projection) as { volume?: Record<string, number> }) : null
  const stockTotal = computeStock(b)
    .filter((r) => r.tracked)
    .reduce((a, r) => a + Math.max(0, r.onHand), 0)
  const buffer = num(b.settings.live_attribution_buffer_min, 15)
  const out: Record<string, KpiContext> = {}
  for (const m of months) {
    const row = monthly.get(m)
    const sales = b.sales.filter((s) => s.order_date.startsWith(m))
    const qty = sales.reduce((a, s) => a + s.qty, 0)
    const bad = sales.reduce((a, s) => a + s.cancel_qty + s.return_qty, 0)
    const mapped = sales.filter((s) => s.sku).reduce((a, s) => a + s.qty, 0)
    const adj = b.adjustments.filter((a) => a.adj_date.startsWith(m))
    const live: KpiContext['live'] = {}
    for (const h of buildLiveReport(liveRows.results as never, b.sales, buffer, m, m).hosts) {
      live[h.host.trim().toLowerCase()] = { sessions: h.sessions, pcs: h.pcs, hours: h.hours, late: [] }
    }
    for (const s of liveRows.results as unknown as LiveSession[]) {
      if (!s.start_at.startsWith(m)) continue
      const late = lateMinutes(s)
      const key = (s.host ?? '').trim().toLowerCase()
      if (late == null || !live[key]) continue
      live[key].late!.push(late)
    }
    const storeTargetDefault = proj?.volume?.[m] ?? null
    out[m] = {
      month: m,
      storeTarget: records[m]?.storeTarget ?? storeTargetDefault,
      storePcs: row?.pcsNet ?? 0,
      netRevenue: row ? row.omzetNet - row.platformFees : 0,
      cancelReturnRate: qty ? bad / qty : null,
      stockDiffRate: adj.length ? adj.reduce((a, x) => a + Math.abs(x.qty_delta), 0) / Math.max(1, stockTotal) : null,
      skuMappedRate: qty ? mapped / qty : null,
      live,
      baseCommission: row ? commissionFor(team, m, row.omzetNet - row.platformFees).by : {},
    }
  }
  return { out, settings: b.settings, team, proj }
}
const prevMonths = (m: string, n: number) => {
  const out: string[] = []
  let [y, mm] = m.split('-').map(Number)
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(mm).padStart(2, '0')}`)
    mm--
    if (mm < 1) {
      mm = 12
      y--
    }
  }
  return out
}
app.get('/kpi', async (c) => {
  const month = /^\d{4}-\d{2}$/.test(c.req.query('month') ?? '') ? c.req.query('month')! : new Date().toISOString().slice(0, 7)
  const settings = await getSettings(c.env.DB)
  const config = parseKpiConfig(settings.kpi_config)
  const months = prevMonths(month, 6)
  const records = Object.fromEntries(months.map((m) => [m, parseKpiMonth(settings[kpiMonthKey(m)])]))
  const { out, proj, team } = await kpiContexts(c.env.DB, months, records)
  const trend = months.map((m) => ({
    month: m,
    finalized: !!records[m].final,
    scores: Object.fromEntries(computeKpi(config, records[m], out[m]).map((r) => [r.staff.id, r.score])),
  }))
  return c.json({
    month,
    config,
    record: records[month],
    ctx: out[month],
    storeTargetDefault: proj?.volume?.[month] ?? null,
    members: team.members.map((x) => x.name),
    trend,
  })
})
app.put('/kpi/config', async (c) => {
  const body = await c.req.json<{ config: KpiConfig }>()
  if (!body?.config || !Array.isArray(body.config.staff)) return c.json({ error: 'Format KPI tidak dikenali' }, 400)
  await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .bind('kpi_config', JSON.stringify(body.config))
    .run()
  return c.json({ ok: true })
})
app.put('/kpi/month/:m', async (c) => {
  const m = c.req.param('m')
  if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: 'Bulan tidak valid' }, 400)
  const body = await c.req.json<{ record: KpiMonthRecord }>()
  const prev = parseKpiMonth((await getSettings(c.env.DB))[kpiMonthKey(m)])
  if (prev.final) return c.json({ error: 'KPI bulan ini sudah difinalisasi. Buka kembali dulu untuk mengubah.' }, 409)
  const rec: KpiMonthRecord = { storeTarget: body.record?.storeTarget ?? null, staff: body.record?.staff ?? {}, final: null, finalizedAt: null }
  await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(kpiMonthKey(m), JSON.stringify(rec)).run()
  return c.json({ ok: true })
})
app.post('/kpi/month/:m/finalize', async (c) => {
  const m = c.req.param('m')
  if (!/^\d{4}-\d{2}$/.test(m)) return c.json({ error: 'Bulan tidak valid' }, 400)
  const body = await c.req.json<{ final: boolean }>()
  const settings = await getSettings(c.env.DB)
  const rec = parseKpiMonth(settings[kpiMonthKey(m)])
  if (body.final) {
    const { out } = await kpiContexts(c.env.DB, [m], { [m]: rec })
    const results = computeKpi(parseKpiConfig(settings.kpi_config), rec, out[m])
    rec.final = Object.fromEntries(results.map((r) => [r.staff.commissionMember, Math.round(r.factor * 10000) / 10000]))
    rec.finalizedAt = new Date().toISOString()
  } else {
    rec.final = null
    rec.finalizedAt = null
  }
  await c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(kpiMonthKey(m), JSON.stringify(rec)).run()
  return c.json({ ok: true, final: rec.final })
})

// ---------- Rencana restock ----------
app.get('/restock', async (c) => {
  const b = await loadBundle(c.env.DB)
  const q = c.req.query()
  const saved = b.settings.restock ? (JSON.parse(b.settings.restock) as Partial<RestockParams>) : {}
  const pick = (k: 'leadDays' | 'reviewDays' | 'windowDays' | 'deadDays', lo: number, hi: number) => Math.min(hi, Math.max(lo, num(q[k] ?? saved[k], DEFAULT_RESTOCK[k] as number)))
  const service = num(q.service ?? saved.service, DEFAULT_RESTOCK.service)
  const target = q.targetMonthly !== undefined ? num(q.targetMonthly, 0) : num(saved.targetMonthly, 0)
  const params: RestockParams = {
    leadDays: pick('leadDays', 0, 365),
    reviewDays: pick('reviewDays', 1, 180),
    windowDays: pick('windowDays', 7, 730),
    deadDays: pick('deadDays', 7, 730),
    service: service >= 0.99 ? 0.99 : service >= 0.95 ? 0.95 : 0.9,
    targetMonthly: target > 0 ? target : null,
    safetyMode: (q.safetyMode ?? saved.safetyMode) === 'days' ? 'days' : 'stat',
    safetyDays: Math.min(365, Math.max(0, num(q.safetyDays ?? saved.safetyDays, DEFAULT_RESTOCK.safetyDays))),
  }
  return c.json({ params, ...computeRestock(b, params, new Date().toISOString().slice(0, 10)) })
})

// ---------- Sesi live ----------
app.get('/live', async (c) => {
  const { from, to } = c.req.query()
  const [sessions, sales, settings] = await Promise.all([
    c.env.DB.prepare('SELECT * FROM live_sessions').all(),
    c.env.DB.prepare('SELECT * FROM sales').all(),
    getSettings(c.env.DB),
  ])
  return c.json(
    buildLiveReport(sessions.results as never, sales.results as never, num(settings.live_attribution_buffer_min, 15), from || undefined, to || undefined),
  )
})
const liveVals = (b: Record<string, unknown>) => [
  b.start_at,
  Math.max(1, Math.round(num(b.duration_min, 60))),
  b.store,
  str(b.host),
  str(b.title),
  b.viewers === '' || b.viewers == null ? null : Math.round(num(b.viewers)),
  str(b.notes),
  /^\d{2}:\d{2}$/.test(String(b.scheduled_time ?? '')) ? String(b.scheduled_time) : null,
]
app.post('/live', async (c) => {
  const body = await c.req.json<Record<string, unknown> | Record<string, unknown>[]>()
  const rows = Array.isArray(body) ? body : [body]
  await runBatched(
    c.env.DB,
    rows.map((b) =>
      c.env.DB.prepare('INSERT INTO live_sessions (start_at, duration_min, store, host, title, viewers, notes, scheduled_time) VALUES (?,?,?,?,?,?,?,?)').bind(...liveVals(b)),
    ),
  )
  return c.json({ ok: true, added: rows.length })
})
app.put('/live/:id', async (c) => {
  await c.env.DB.prepare('UPDATE live_sessions SET start_at=?, duration_min=?, store=?, host=?, title=?, viewers=?, notes=?, scheduled_time=? WHERE id=?')
    .bind(...liveVals(await c.req.json()), c.req.param('id'))
    .run()
  return c.json({ ok: true })
})
app.delete('/live/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM live_sessions WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Cadangan & impor data lengkap ----------
const TABLES = BACKUP_TABLES

app.get('/data/export', async (c) => {
  c.header('Content-Disposition', `attachment; filename="glamora88-cadangan-${new Date().toISOString().slice(0, 10)}.json"`)
  return c.json({ version: 1, exported_at: new Date().toISOString(), tables: await exportTables(c.env.DB) })
})

// Reset data: hapus isi tabel. keepSetup = pertahankan pengaturan, toko, produk, varian & pemetaan SKU.
const SETUP_TABLES: string[] = ['settings', 'stores', 'products', 'variants', 'sku_map', 'agenda']
app.post('/data/reset', async (c) => {
  const body = await c.req.json<{ confirm?: string; keepSetup?: boolean }>().catch(() => ({}) as { confirm?: string; keepSetup?: boolean })
  if (body.confirm !== 'RESET') return c.json({ error: 'Konfirmasi tidak cocok' }, 400)
  const db = c.env.DB
  await makeBackup(db, 'sebelum reset', c.get('user').name)
  const targets = [...TABLES].reverse().filter((t) => !(body.keepSetup && SETUP_TABLES.includes(t)))
  const counts: Record<string, number> = {}
  for (const t of targets) {
    const r = await db.prepare(`DELETE FROM ${t}`).run()
    counts[t] = r.meta.changes ?? 0
  }
  if (!body.keepSetup) {
    // pengaturan kembali ke nilai bawaan
    await db.batch(Object.entries(DEFAULT_SETTINGS).map(([k, v]) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').bind(k, v)))
  }
  return c.json({ ok: true, counts })
})

app.post('/data/import', async (c) => {
  const body = await c.req.json<{ tables: Record<string, Record<string, unknown>[]> }>()
  if (!body?.tables) return c.json({ error: 'Format file tidak dikenali' }, 400)
  await makeBackup(c.env.DB, 'sebelum impor', c.get('user').name)
  return c.json({ ok: true, counts: await restoreTables(c.env.DB, body.tables) })
})

// ---------- Cadangan otomatis (khusus owner) ----------
app.get('/data/backups', async (c) => c.json(await listBackups(c.env.DB)))
app.post('/data/backups', async (c) => c.json({ ok: true, id: await makeBackup(c.env.DB, 'manual', c.get('user').name) }))
app.get('/data/backups/:id', async (c) => {
  const json = await readBackup(c.env.DB, Number(c.req.param('id')))
  if (!json) return c.json({ error: 'Cadangan tidak ditemukan' }, 404)
  const row = await c.env.DB.prepare('SELECT created_at FROM backups WHERE id = ?').bind(Number(c.req.param('id'))).first<{ created_at: string }>()
  c.header('Content-Type', 'application/json')
  c.header('Content-Disposition', `attachment; filename="glamora88-cadangan-${(row?.created_at ?? '').slice(0, 10)}-${c.req.param('id')}.json"`)
  return c.body(json)
})
app.post('/data/backups/:id/restore', async (c) => {
  const b = await c.req.json<{ confirm?: string }>().catch(() => ({}) as { confirm?: string })
  if (b.confirm !== 'PULIHKAN') return c.json({ error: 'Konfirmasi tidak cocok' }, 400)
  const json = await readBackup(c.env.DB, Number(c.req.param('id')))
  if (!json) return c.json({ error: 'Cadangan tidak ditemukan' }, 404)
  await makeBackup(c.env.DB, 'sebelum pemulihan', c.get('user').name)
  const data = JSON.parse(json) as { tables: Record<string, Record<string, unknown>[]> }
  return c.json({ ok: true, counts: await restoreTables(c.env.DB, data.tables) })
})

export default app
