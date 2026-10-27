// Definisi laporan Excel. Setiap laporan menghasilkan satu atau beberapa sheet.
import type { DashboardData } from '../../shared/dashboard'
import type { LiveReport } from '../../shared/live'
import type { StockRow } from '../../shared/metrics'
import type { Boost, Expense, Product, Purchase, PurchaseItem, Sale, Variant } from '../../shared/types'
import { api, qs } from './api'
import type { SheetSpec } from './excel'
import { monthLabel } from './format'

export interface ReportCtx {
  from: string
  to: string
  store: string
}

const inPeriod = (d: string, c: ReportCtx) => (!c.from || d.slice(0, 7) >= c.from) && (!c.to || d.slice(0, 7) <= c.to)
const periodText = (c: ReportCtx, fallback?: { from: string; to: string }) => {
  const f = c.from || fallback?.from
  const t = c.to || fallback?.to
  return f && t ? `${monthLabel(f, true)} – ${monthLabel(t, true)}` : 'Semua periode'
}
const metaOf = (c: ReportCtx, fallback?: { from: string; to: string }, extra = '') => {
  const now = new Date()
  const made = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`
  return `Periode: ${periodText(c, fallback)} · Toko: ${c.store || 'Semua toko'}${extra ? ` · ${extra}` : ''} · Dibuat: ${made}`
}

async function catalog() {
  const p = await api.get<{ products: Product[]; variants: Variant[] }>('/products')
  const pname = new Map(p.products.map((x) => [x.code, x.name]))
  const vmap = new Map(p.variants.map((v) => [v.sku, v]))
  const label = (sku: string | null) => {
    const v = sku ? vmap.get(sku) : null
    return v ? `${pname.get(v.product_code) ?? v.product_code} · ${v.color}` : sku ?? 'Belum dipetakan'
  }
  return { ...p, pname, vmap, label }
}

// ---------- Ringkasan & laba-rugi ----------
type KV = [string, number | null, 'rp' | 'int' | 'pct']
export async function reportSummary(c: ReportCtx): Promise<SheetSpec[]> {
  const d = await api.get<DashboardData>(`/dashboard${qs({ ...c })}`)
  const k = d.kpi
  const b = d.bep
  const kv = [
    ['Omzet neto', k.omzetNet, 'rp'],
    ['Produk terjual (pcs)', k.pcsNet, 'int'],
    ['Pesanan', k.orders, 'int'],
    ['Harga rata-rata per pcs', k.avgPrice, 'rp'],
    ['Tingkat retur', k.returnRate, 'pct'],
    ['Margin kontribusi', k.contributionPct, 'pct'],
    ['Laba (rugi) operasional', k.operatingProfit, 'rp'],
    ['Biaya boost', k.boostSpend, 'rp'],
    ['Nilai stok di gudang (saat ini)', k.stockValue, 'rp'],
    ['Stok di gudang (pcs, saat ini)', k.stockUnits, 'int'],
    ['Rata-rata omzet per bulan', b.actualOmzetPerMonth, 'rp'],
    ['Biaya tetap rata-rata per bulan', b.fixedPerMonth, 'rp'],
    ['Titik impas – omzet per bulan', b.bepOmzet, 'rp'],
    ['Titik impas – pcs per bulan', b.bepPcs, 'int'],
    ['Pencapaian terhadap titik impas', b.progress, 'pct'],
    ...(b.plannedFixed
      ? [
          ['Rencana biaya tetap per bulan', b.plannedFixed, 'rp'],
          ['Titik impas rencana – omzet per bulan', b.plannedBepOmzet, 'rp'],
          ['Titik impas rencana – pcs per bulan', b.plannedBepPcs, 'int'],
        ]
      : []),
  ] as KV[]
  const fb = { from: d.period.from, to: d.period.to }
  return [
    {
      name: 'Ringkasan',
      title: 'Ringkasan Kinerja',
      meta: metaOf(c, fb),
      blocks: [
        {
          heading: 'Indikator utama',
          columns: [
            { header: 'Indikator', value: (r: KV) => r[0], width: 42 },
            { header: 'Rupiah', value: (r: KV) => (r[2] === 'rp' ? r[1] : null), kind: 'rp', width: 20 },
            { header: 'Jumlah', value: (r: KV) => (r[2] === 'int' ? r[1] : null), kind: 'int', width: 12 },
            { header: 'Persen', value: (r: KV) => (r[2] === 'pct' ? r[1] : null), kind: 'pct', width: 10 },
          ],
          rows: kv,
        },
        {
          heading: 'Catatan otomatis',
          fullWidth: true,
          columns: [{ header: 'Catatan', value: (r: (typeof d.insights)[number]) => `${r.title}. ${r.detail}` }],
          rows: d.insights,
        },
      ],
    },
    {
      name: 'Laba-Rugi Bulanan',
      title: 'Laba-Rugi Bulanan',
      meta: metaOf(c, fb),
      blocks: [
        {
          columns: [
            { header: 'Bulan', value: (r) => r.month, kind: 'month' },
            { header: 'Pcs terjual', value: (r) => r.pcsNet, kind: 'int', total: 'sum' },
            { header: 'Pesanan', value: (r) => r.orders, kind: 'int', total: 'sum' },
            { header: 'Omzet neto', value: (r) => r.omzetNet, kind: 'rp', total: 'sum' },
            { header: 'HPP', value: (r) => r.hpp, kind: 'rp', total: 'sum' },
            { header: 'Laba kotor', value: (r) => r.omzetNet - r.hpp, kind: 'rp', total: 'sum' },
            { header: 'Potongan TikTok', value: (r) => r.platformFees, kind: 'rp', total: 'sum' },
            { header: 'Biaya variabel (komisi)', value: (r) => r.variableExpenses, kind: 'rp', total: 'sum' },
            { header: 'Biaya tetap', value: (r) => r.fixedCosts, kind: 'rp', total: 'sum' },
            { header: 'Boost', value: (r) => r.boost, kind: 'rp', total: 'sum' },
            { header: 'Laba (rugi) operasional', value: (r) => r.operatingProfit, kind: 'rp', total: 'sum' },
            { header: 'Margin operasional', value: (r) => (r.omzetNet ? r.operatingProfit / r.omzetNet : null), kind: 'pct' },
          ],
          rows: d.monthly,
          note: 'Laba operasional belum termasuk gaji/prive owner dan pajak. Potongan TikTok memakai angka asli untuk pesanan yang sudah ada di laporan settlement, selain itu perkiraan tarif.',
        },
        {
          heading: 'Arus kas',
          columns: [
            { header: 'Bulan', value: (r) => r.month, kind: 'month' },
            { header: 'Dana cair dari TikTok', value: (r) => r.cashIn, kind: 'rp', total: 'sum' },
            { header: 'Kas keluar operasional', value: (r) => -r.cashOutOps, kind: 'rp', total: 'sum' },
            { header: 'Pembelian stok', value: (r) => -r.cashPurchases, kind: 'rp', total: 'sum' },
            { header: 'Arus kas bersih', value: (r) => r.netCash, kind: 'rp', total: 'sum' },
            { header: 'Arus kas kumulatif', value: (r) => r.cumulativeCash, kind: 'rp' },
          ],
          rows: d.monthly,
        },
      ],
    },
  ]
}

// ---------- Penjualan ----------
export async function reportSales(c: ReportCtx): Promise<SheetSpec[]> {
  const [sales, cat, d] = await Promise.all([
    api.get<Sale[]>(`/sales${qs({ ...c })}`),
    catalog(),
    api.get<DashboardData>(`/dashboard${qs({ ...c })}`),
  ])
  const net = (s: Sale) => s.qty - s.return_qty - s.cancel_qty
  const fb = { from: d.period.from, to: d.period.to }
  return [
    {
      name: 'Penjualan per Model',
      title: 'Penjualan per Model',
      meta: metaOf(c, fb),
      blocks: [
        {
          columns: [
            { header: 'Kode', value: (r) => r.code },
            { header: 'Model', value: (r) => r.name, width: 28 },
            { header: 'Terjual kotor (pcs)', value: (r) => r.grossQty, kind: 'int', total: 'sum' },
            { header: 'Retur (pcs)', value: (r) => r.returns, kind: 'int', total: 'sum' },
            { header: 'Terjual neto (pcs)', value: (r) => r.pcsNet, kind: 'int', total: 'sum' },
            { header: 'Omzet neto', value: (r) => r.omzetNet, kind: 'rp', total: 'sum' },
            { header: 'Harga rata-rata', value: (r) => (r.pcsNet ? r.omzetNet / r.pcsNet : null), kind: 'rp' },
            { header: '% retur', value: (r) => (r.grossQty ? r.returns / r.grossQty : null), kind: 'pct' },
          ],
          rows: d.byModel,
        },
        {
          heading: 'Per bulan per toko',
          columns: [
            { header: 'Bulan', value: (r) => r.month, kind: 'month' },
            ...d.stores.map((st) => ({ header: st, value: (r: (typeof d.monthly)[number]) => r.omzetByStore[st] ?? 0, kind: 'rp' as const, total: 'sum' as const })),
            { header: 'Total omzet neto', value: (r) => r.omzetNet, kind: 'rp', total: 'sum' },
            { header: 'Pcs', value: (r) => r.pcsNet, kind: 'int', total: 'sum' },
            { header: 'Retur (pcs)', value: (r) => r.returnsQty, kind: 'int', total: 'sum' },
          ],
          rows: d.monthly,
        },
      ],
    },
    {
      name: 'Detail Penjualan',
      title: 'Detail Penjualan per Pesanan',
      meta: metaOf(c, fb, `${sales.length} baris`),
      blocks: [
        {
          columns: [
            { header: 'Tanggal', value: (s: Sale) => s.order_date, kind: 'datetime' },
            { header: 'Toko', value: (s: Sale) => s.store },
            { header: 'No. pesanan', value: (s: Sale) => s.order_id, width: 21 },
            { header: 'SKU', value: (s: Sale) => s.sku ?? s.platform_sku_id },
            { header: 'Produk', value: (s: Sale) => cat.label(s.sku), width: 32 },
            { header: 'Qty', value: (s: Sale) => s.qty, kind: 'int', total: 'sum' },
            { header: 'Retur', value: (s: Sale) => s.return_qty, kind: 'int', total: 'sum' },
            { header: 'Batal', value: (s: Sale) => s.cancel_qty, kind: 'int', total: 'sum' },
            { header: 'Qty neto', value: (s: Sale) => net(s), kind: 'int', total: 'sum' },
            { header: 'Harga satuan', value: (s: Sale) => s.unit_price, kind: 'rp' },
            { header: 'Omzet neto', value: (s: Sale) => net(s) * s.unit_price, kind: 'rp', total: 'sum' },
            { header: 'Status', value: (s: Sale) => s.status },
            { header: 'Sumber', value: (s: Sale) => (s.source === 'manual' ? 'Manual' : 'Export TikTok') },
          ],
          rows: [...sales].sort((a, b) => a.order_date.localeCompare(b.order_date)),
          note: sales.length >= 2000 ? 'Dibatasi 2.000 baris; persempit periode untuk detail lengkap.' : undefined,
        },
      ],
    },
  ]
}

// ---------- Stok ----------
export async function reportStock(c: ReportCtx): Promise<SheetSpec[]> {
  const stock = await api.get<StockRow[]>('/stock')
  const rows = stock.filter((r) => r.tracked)
  return [
    {
      name: 'Stok per SKU',
      title: 'Posisi Stok per SKU',
      meta: metaOf({ ...c, from: '', to: '' }, undefined, 'posisi saat ini'),
      blocks: [
        {
          columns: [
            { header: 'Kode', value: (r: StockRow) => r.product_code },
            { header: 'Model', value: (r: StockRow) => r.product_name, width: 26 },
            { header: 'SKU', value: (r: StockRow) => r.sku },
            { header: 'Warna', value: (r: StockRow) => r.color },
            { header: 'Dibeli (tiba)', value: (r: StockRow) => r.arrived, kind: 'int', total: 'sum' },
            { header: 'Dalam perjalanan', value: (r: StockRow) => r.inTransit, kind: 'int', total: 'sum' },
            { header: 'Terjual neto', value: (r: StockRow) => r.soldNet, kind: 'int', total: 'sum' },
            { header: 'Penyesuaian', value: (r: StockRow) => r.adjustments, kind: 'int', total: 'sum' },
            { header: 'Sisa stok', value: (r: StockRow) => r.onHand, kind: 'int', total: 'sum' },
            { header: 'Landed cost / pcs', value: (r: StockRow) => r.landed, kind: 'rp' },
            { header: 'Nilai stok', value: (r: StockRow) => r.value, kind: 'rp', total: 'sum' },
            { header: '% terjual', value: (r: StockRow) => r.sellThrough, kind: 'pct' },
            { header: 'Terakhir laku', value: (r: StockRow) => r.lastSale?.slice(0, 10) ?? 'Belum pernah', kind: 'date' },
          ],
          rows,
          note: 'Sisa stok = dibeli (batch berstatus Tiba) − terjual neto + penyesuaian stock opname. Nilai stok memakai landed cost rata-rata.',
        },
      ],
    },
  ]
}

// ---------- Pembelian ----------
export async function reportPurchases(c: ReportCtx): Promise<SheetSpec[]> {
  const [p, cat, s] = await Promise.all([
    api.get<{ purchases: Purchase[]; items: PurchaseItem[] }>('/purchases'),
    catalog(),
    api.get<{ settings: Record<string, string> }>('/settings'),
  ])
  const fallback = Number(s.settings.fallback_landed_cost || 120000)
  const list = p.purchases.filter((x) => inPeriod(x.order_date, c))
  const itemsOf = (id: number) => p.items.filter((i) => i.purchase_id === id)
  const cost = (x: Purchase) => {
    const its = itemsOf(x.id)
    const q = its.reduce((a, i) => a + i.qty, 0)
    const oh = Number(x.cargo_cost) + Number(x.other_cost)
    const goods = its.reduce((a, i) => a + i.qty * (i.price_cny != null ? i.price_cny * x.exchange_rate : fallback - (q ? oh / q : 0)), 0)
    return { q, total: goods + oh, goods, oh }
  }
  const items = list.flatMap((x) => {
    const cc = cost(x)
    return itemsOf(x.id).map((i) => ({ batch: x.name, date: x.order_date, status: x.status, sku: i.sku, qty: i.qty, cny: i.price_cny, rate: x.exchange_rate, perPcsOverhead: cc.q ? cc.oh / cc.q : 0 }))
  })
  return [
    {
      name: 'Pembelian',
      title: 'Pembelian & Impor',
      meta: metaOf(c),
      blocks: [
        {
          heading: 'Per batch',
          columns: [
            { header: 'Batch', value: (x: Purchase) => x.name },
            { header: 'Tanggal bayar', value: (x: Purchase) => x.order_date, kind: 'date' },
            { header: 'Tanggal tiba', value: (x: Purchase) => x.arrival_date, kind: 'date' },
            { header: 'Status', value: (x: Purchase) => x.status },
            { header: 'Supplier / jasa impor', value: (x: Purchase) => x.supplier, width: 24 },
            { header: 'Pcs', value: (x: Purchase) => cost(x).q, kind: 'int', total: 'sum' },
            { header: 'Kurs (Rp/CNY)', value: (x: Purchase) => x.exchange_rate, kind: 'int' },
            { header: 'Nilai barang', value: (x: Purchase) => cost(x).goods, kind: 'rp', total: 'sum' },
            { header: 'Cargo & biaya lain', value: (x: Purchase) => cost(x).oh, kind: 'rp', total: 'sum' },
            { header: 'Total biaya', value: (x: Purchase) => cost(x).total, kind: 'rp', total: 'sum' },
            { header: 'Landed cost rata-rata', value: (x: Purchase) => (cost(x).q ? cost(x).total / cost(x).q : null), kind: 'rp' },
            { header: 'Catatan', value: (x: Purchase) => x.notes, width: 50 },
          ],
          rows: list,
        },
        {
          heading: 'Isi batch per SKU',
          columns: [
            { header: 'Batch', value: (r: (typeof items)[number]) => r.batch },
            { header: 'Tanggal bayar', value: (r: (typeof items)[number]) => r.date, kind: 'date' },
            { header: 'SKU', value: (r: (typeof items)[number]) => r.sku },
            { header: 'Produk', value: (r: (typeof items)[number]) => cat.label(r.sku), width: 30 },
            { header: 'Qty', value: (r: (typeof items)[number]) => r.qty, kind: 'int', total: 'sum' },
            { header: 'Harga beli (CNY)', value: (r: (typeof items)[number]) => r.cny, kind: 'dec' },
            {
              header: 'Landed cost / pcs',
              value: (r: (typeof items)[number]) => (r.cny != null ? r.cny * r.rate + r.perPcsOverhead : fallback),
              kind: 'rp',
            },
            { header: 'Status', value: (r: (typeof items)[number]) => r.status },
          ],
          rows: items,
        },
      ],
    },
  ]
}

// ---------- Boost ----------
export async function reportBoosts(c: ReportCtx): Promise<SheetSpec[]> {
  const rows = (await api.get<Boost[]>('/boosts')).filter((b) => inPeriod(b.boost_date, c) && (!c.store || b.store === c.store)).sort((a, b) => a.boost_date.localeCompare(b.boost_date))
  return [
    {
      name: 'Boost',
      title: 'Boost & Promosi',
      meta: metaOf(c),
      blocks: [
        {
          columns: [
            { header: 'Tanggal', value: (b: Boost) => b.boost_date, kind: 'datetime' },
            { header: 'Toko', value: (b: Boost) => b.store },
            { header: 'Jenis', value: (b: Boost) => b.kind },
            { header: 'Judul', value: (b: Boost) => b.title, width: 36 },
            { header: 'Status', value: (b: Boost) => b.status },
            { header: 'Budget', value: (b: Boost) => b.budget, kind: 'rp', total: 'sum' },
            { header: 'Kupon', value: (b: Boost) => b.coupon, kind: 'rp', total: 'sum' },
            { header: 'Apple fee', value: (b: Boost) => b.apple_fee, kind: 'rp', total: 'sum' },
            { header: 'Uang keluar', value: (b: Boost) => b.budget - b.coupon + b.apple_fee, kind: 'rp', total: 'sum' },
            { header: 'Pembelian', value: (b: Boost) => b.purchases, kind: 'int', total: 'sum' },
            { header: 'Penonton live', value: (b: Boost) => b.viewers, kind: 'int', total: 'sum' },
            { header: 'Video views', value: (b: Boost) => b.views, kind: 'int', total: 'sum' },
          ],
          rows,
          note: 'Uang keluar = budget − kupon + Apple service fee.',
        },
      ],
    },
  ]
}

// ---------- Biaya ----------
export async function reportExpenses(c: ReportCtx): Promise<SheetSpec[]> {
  const rows = (await api.get<Expense[]>('/expenses')).filter((e) => inPeriod(e.exp_date, c)).sort((a, b) => a.exp_date.localeCompare(b.exp_date))
  const months = [...new Set(rows.map((e) => e.exp_date.slice(0, 7)))].sort()
  const classes = ['Tetap', 'Tetap (diskresioner)', 'Semi-variabel', 'Variabel']
  const pivot = months.map((m) => {
    const rr = rows.filter((e) => e.exp_date.startsWith(m))
    return { m, by: Object.fromEntries(classes.map((k) => [k, rr.filter((e) => !e.cash_only && e.classification === k).reduce((a, e) => a + e.amount, 0)])), cash: rr.filter((e) => e.cash_only).reduce((a, e) => a + e.amount, 0), total: rr.reduce((a, e) => a + e.amount, 0) }
  })
  return [
    {
      name: 'Biaya Operasional',
      title: 'Biaya Operasional',
      meta: metaOf(c, undefined, 'tidak termasuk boost'),
      blocks: [
        {
          heading: 'Rekap per bulan menurut klasifikasi',
          columns: [
            { header: 'Bulan', value: (r: (typeof pivot)[number]) => r.m, kind: 'month' },
            ...classes.map((k) => ({ header: k, value: (r: (typeof pivot)[number]) => r.by[k], kind: 'rp' as const, total: 'sum' as const })),
            { header: 'Kas saja (bukan beban)', value: (r: (typeof pivot)[number]) => r.cash, kind: 'rp', total: 'sum' },
            { header: 'Total', value: (r: (typeof pivot)[number]) => r.total, kind: 'rp', total: 'sum' },
          ],
          rows: pivot,
        },
        {
          heading: 'Rincian',
          columns: [
            { header: 'Tanggal', value: (e: Expense) => e.exp_date, kind: 'date' },
            { header: 'Pos biaya', value: (e: Expense) => e.category },
            { header: 'Keterangan', value: (e: Expense) => e.description, width: 46 },
            { header: 'Klasifikasi', value: (e: Expense) => (e.cash_only ? 'Kas (bukan beban)' : e.classification) },
            { header: 'Jumlah', value: (e: Expense) => e.amount, kind: 'rp', total: 'sum' },
          ],
          rows,
        },
      ],
    },
  ]
}

// ---------- Sesi live ----------
export async function reportLive(c: ReportCtx): Promise<SheetSpec[]> {
  const r = await api.get<LiveReport>(`/live${qs({ from: c.from, to: c.to })}`)
  const sessions = r.sessions.filter((s) => !c.store || s.store === c.store).sort((a, b) => a.start_at.localeCompare(b.start_at))
  return [
    {
      name: 'Sesi Live',
      title: 'Sesi Live & Kinerja Host',
      meta: metaOf(c),
      blocks: [
        {
          heading: 'Kinerja per host',
          columns: [
            { header: 'Host', value: (h: (typeof r.hosts)[number]) => h.host, width: 20 },
            { header: 'Sesi', value: (h: (typeof r.hosts)[number]) => h.sessions, kind: 'int', total: 'sum' },
            { header: 'Jam live', value: (h: (typeof r.hosts)[number]) => h.hours, kind: 'dec', total: 'sum' },
            { header: 'Pcs', value: (h: (typeof r.hosts)[number]) => h.pcs, kind: 'int', total: 'sum' },
            { header: 'Omzet', value: (h: (typeof r.hosts)[number]) => h.omzet, kind: 'rp', total: 'sum' },
            { header: 'Pcs per jam', value: (h: (typeof r.hosts)[number]) => h.pcsPerHour, kind: 'dec' },
            { header: 'Omzet per jam', value: (h: (typeof r.hosts)[number]) => h.omzetPerHour, kind: 'rp' },
            { header: 'Sesi tanpa penjualan', value: (h: (typeof r.hosts)[number]) => h.zeroSessions, kind: 'int', total: 'sum' },
          ],
          rows: r.hosts,
        },
        {
          heading: 'Daftar sesi',
          columns: [
            { header: 'Mulai', value: (s: (typeof sessions)[number]) => s.start_at, kind: 'datetime' },
            { header: 'Selesai', value: (s: (typeof sessions)[number]) => s.end_at, kind: 'datetime' },
            { header: 'Durasi (menit)', value: (s: (typeof sessions)[number]) => s.duration_min, kind: 'int', total: 'sum' },
            { header: 'Toko', value: (s: (typeof sessions)[number]) => s.store },
            { header: 'Host', value: (s: (typeof sessions)[number]) => s.host },
            { header: 'Judul', value: (s: (typeof sessions)[number]) => s.title, width: 30 },
            { header: 'Penonton', value: (s: (typeof sessions)[number]) => s.viewers, kind: 'int', total: 'sum' },
            { header: 'Pesanan', value: (s: (typeof sessions)[number]) => s.orders, kind: 'int', total: 'sum' },
            { header: 'Pcs', value: (s: (typeof sessions)[number]) => s.pcs, kind: 'int', total: 'sum' },
            { header: 'Omzet', value: (s: (typeof sessions)[number]) => s.omzet, kind: 'rp', total: 'sum' },
            { header: 'Omzet per jam', value: (s: (typeof sessions)[number]) => s.omzetPerHour, kind: 'rp' },
          ],
          rows: sessions,
          note: 'Penjualan sesi = pesanan toko tersebut yang masuk selama live berlangsung (plus toleransi di Pengaturan).',
        },
      ],
    },
  ]
}

// ---------- Pencairan TikTok ----------
interface SettlementReport {
  totals: { revenue: number; fees: number; amount: number }
  byMonth: { month: string; count: number; revenue: number; fees: number; amount: number }[]
  components: { name: string; total: number }[]
  unsettled: { items: { store: string; order_id: string; date: string; omzet: number }[] }
}
export async function reportSettlement(c: ReportCtx): Promise<SheetSpec[]> {
  const r = await api.get<SettlementReport>('/settlements/report')
  return [
    {
      name: 'Pencairan TikTok',
      title: 'Pencairan TikTok (Settlement)',
      meta: metaOf({ ...c, from: '', to: '' }, undefined, 'semua laporan yang diunggah'),
      blocks: [
        {
          heading: 'Per bulan pencairan',
          columns: [
            { header: 'Bulan', value: (m: (typeof r.byMonth)[number]) => (/^\d{4}-\d{2}$/.test(m.month) ? m.month : null), kind: 'month' },
            { header: 'Baris', value: (m: (typeof r.byMonth)[number]) => m.count, kind: 'int', total: 'sum' },
            { header: 'Pendapatan', value: (m: (typeof r.byMonth)[number]) => m.revenue, kind: 'rp', total: 'sum' },
            { header: 'Potongan', value: (m: (typeof r.byMonth)[number]) => m.fees, kind: 'rp', total: 'sum' },
            { header: '% potongan', value: (m: (typeof r.byMonth)[number]) => (m.revenue ? m.fees / m.revenue : null), kind: 'pct' },
            { header: 'Dana cair', value: (m: (typeof r.byMonth)[number]) => m.amount, kind: 'rp', total: 'sum' },
          ],
          rows: r.byMonth,
        },
        {
          heading: 'Komponen potongan & pendapatan',
          columns: [
            { header: 'Komponen', value: (x: (typeof r.components)[number]) => x.name, width: 40 },
            { header: 'Total', value: (x: (typeof r.components)[number]) => x.total, kind: 'rp' },
          ],
          rows: r.components,
        },
        {
          heading: 'Pesanan terjual yang belum ada di laporan pencairan',
          columns: [
            { header: 'Tanggal', value: (x: (typeof r.unsettled.items)[number]) => x.date, kind: 'datetime' },
            { header: 'Toko', value: (x: (typeof r.unsettled.items)[number]) => x.store },
            { header: 'No. pesanan', value: (x: (typeof r.unsettled.items)[number]) => x.order_id, width: 21 },
            { header: 'Omzet', value: (x: (typeof r.unsettled.items)[number]) => x.omzet, kind: 'rp', total: 'sum' },
          ],
          rows: r.unsettled.items,
        },
      ],
    },
  ]
}

export const REPORTS = [
  { id: 'summary', title: 'Ringkasan & Laba-Rugi', desc: 'Indikator utama, titik impas, catatan otomatis, laba-rugi dan arus kas per bulan.', sheets: ['Ringkasan', 'Laba-Rugi Bulanan'], run: reportSummary },
  { id: 'sales', title: 'Penjualan', desc: 'Per model, per bulan per toko, dan detail setiap baris pesanan.', sheets: ['Penjualan per Model', 'Detail Penjualan'], run: reportSales },
  { id: 'stock', title: 'Stok per SKU', desc: 'Dibeli, terjual, sisa, nilai stok, dan kapan terakhir laku (posisi saat ini).', sheets: ['Stok per SKU'], run: reportStock },
  { id: 'purchases', title: 'Pembelian & Impor', desc: 'Biaya per batch dan isi batch per SKU beserta landed cost.', sheets: ['Pembelian'], run: reportPurchases },
  { id: 'boosts', title: 'Boost & Promosi', desc: 'Setiap promosi: budget, kupon, Apple fee, uang keluar, dan hasil.', sheets: ['Boost'], run: reportBoosts },
  { id: 'expenses', title: 'Biaya Operasional', desc: 'Rekap per bulan menurut klasifikasi dan rincian setiap biaya.', sheets: ['Biaya Operasional'], run: reportExpenses },
  { id: 'live', title: 'Sesi Live', desc: 'Kinerja per host dan daftar sesi dengan penjualannya.', sheets: ['Sesi Live'], run: reportLive },
  { id: 'settlement', title: 'Pencairan TikTok', desc: 'Dana cair, potongan per komponen, dan pesanan yang belum cair.', sheets: ['Pencairan TikTok'], run: reportSettlement },
] as const
