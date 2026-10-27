import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { checkPassword, clearSessionCookie, isAuthenticated, makeSessionCookie } from '../../server/auth'
import { ensureSchema, getSettings, num, runBatched, type Env } from '../../server/db'
import { buildDashboard } from '../../shared/dashboard'
import { computeStock, type DataBundle } from '../../shared/metrics'
import type { ImportedSaleLine } from '../../shared/types'

const app = new Hono<{ Bindings: Env }>().basePath('/api')

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: err.message || 'Terjadi kesalahan di server' }, 500)
})

// ---------- Autentikasi ----------
app.post('/login', async (c) => {
  if (!c.env.APP_PASSWORD) return c.json({ error: 'APP_PASSWORD belum diatur di Cloudflare (lihat README).' }, 503)
  const body = await c.req.json<{ password?: string }>().catch(() => ({ password: '' }))
  if (!checkPassword(body.password ?? '', c.env)) return c.json({ error: 'Kata sandi salah' }, 401)
  c.header('Set-Cookie', await makeSessionCookie(c.env))
  return c.json({ ok: true })
})

app.post('/logout', (c) => {
  c.header('Set-Cookie', clearSessionCookie())
  return c.json({ ok: true })
})

app.use('*', async (c, next) => {
  if (c.req.path === '/api/login' || c.req.path === '/api/logout') return next()
  if (!(await isAuthenticated(c.req.header('Cookie'), c.env))) return c.json({ error: 'Silakan masuk terlebih dahulu' }, 401)
  if (!c.env.DB) return c.json({ error: 'Database D1 belum terhubung (binding "DB"). Lihat README.' }, 503)
  await ensureSchema(c.env.DB)
  return next()
})

app.get('/me', (c) => c.json({ ok: true }))

// ---------- Helper ----------
async function loadBundle(db: D1Database): Promise<DataBundle> {
  const [settings, products, variants, sales, purchases, purchaseItems, adjustments, boosts, expenses] = await Promise.all([
    getSettings(db),
    db.prepare('SELECT * FROM products').all(),
    db.prepare('SELECT * FROM variants').all(),
    db.prepare('SELECT * FROM sales').all(),
    db.prepare('SELECT * FROM purchases').all(),
    db.prepare('SELECT * FROM purchase_items').all(),
    db.prepare('SELECT * FROM stock_adjustments').all(),
    db.prepare('SELECT * FROM boosts').all(),
    db.prepare('SELECT * FROM expenses').all(),
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
  return c.json({ settings: await getSettings(c.env.DB), stores: stores.results })
})
app.put('/settings', async (c) => {
  const body = await c.req.json<Record<string, string>>()
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
  if (pid) {
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
      .map((x) =>
        db
          .prepare('INSERT INTO purchase_items (purchase_id, sku, qty, price_cny) VALUES (?, ?, ?, ?)')
          .bind(pid, x.sku, Math.round(num(x.qty)), x.price_cny === null || (x.price_cny as unknown) === '' ? null : num(x.price_cny)),
      ),
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
app.get('/expenses', async (c) => c.json((await c.env.DB.prepare('SELECT * FROM expenses ORDER BY exp_date DESC, id DESC').all()).results))
const expVals = (b: Record<string, unknown>) => [b.exp_date, b.category, str(b.description), num(b.amount), b.classification || 'Tetap', b.cash_only ? 1 : 0]
app.post('/expenses', async (c) => {
  await c.env.DB.prepare('INSERT INTO expenses (exp_date, category, description, amount, classification, cash_only) VALUES (?,?,?,?,?,?)')
    .bind(...expVals(await c.req.json()))
    .run()
  return c.json({ ok: true })
})
app.put('/expenses/:id', async (c) => {
  await c.env.DB.prepare('UPDATE expenses SET exp_date=?, category=?, description=?, amount=?, classification=?, cash_only=? WHERE id=?')
    .bind(...expVals(await c.req.json()), c.req.param('id'))
    .run()
  return c.json({ ok: true })
})
app.delete('/expenses/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM expenses WHERE id = ?').bind(c.req.param('id')).run()
  return c.json({ ok: true })
})

// ---------- Cadangan & impor data lengkap ----------
const TABLES = ['settings', 'stores', 'products', 'variants', 'sku_map', 'sales', 'purchases', 'purchase_items', 'stock_adjustments', 'boosts', 'expenses'] as const

app.get('/data/export', async (c) => {
  const out: Record<string, unknown[]> = {}
  for (const t of TABLES) out[t] = (await c.env.DB.prepare(`SELECT * FROM ${t}`).all()).results
  c.header('Content-Disposition', `attachment; filename="glamora88-cadangan-${new Date().toISOString().slice(0, 10)}.json"`)
  return c.json({ version: 1, exported_at: new Date().toISOString(), tables: out })
})

app.post('/data/import', async (c) => {
  const body = await c.req.json<{ tables: Record<string, Record<string, unknown>[]> }>()
  if (!body?.tables) return c.json({ error: 'Format file tidak dikenali' }, 400)
  const db = c.env.DB
  // hapus dari tabel anak dulu
  for (const t of [...TABLES].reverse()) if (body.tables[t]) await db.prepare(`DELETE FROM ${t}`).run()
  const counts: Record<string, number> = {}
  for (const t of TABLES) {
    const rows = body.tables[t]
    if (!rows?.length) continue
    const cols = Object.keys(rows[0]).filter((k) => /^[a-z_]+$/.test(k))
    const sql = `INSERT INTO ${t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
    await runBatched(
      db,
      rows.map((r) => db.prepare(sql).bind(...cols.map((k) => (r[k] === undefined ? null : r[k])))),
    )
    counts[t] = rows.length
  }
  return c.json({ ok: true, counts })
})

export const onRequest = handle(app)
