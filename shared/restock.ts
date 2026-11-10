// Perencanaan restock per SKU: laju jual, safety stock, reorder point, saran pesan, dan deadstock.
import { computeStock, netQty, type DataBundle } from './metrics'

export interface RestockParams {
  /** hari dari bayar sampai barang tiba */
  leadDays: number
  /** jarak antar pesanan (hari) */
  reviewDays: number
  /** tingkat layanan: peluang tidak kehabisan stok selama menunggu barang */
  service: 0.9 | 0.95 | 0.99
  /** jumlah hari terakhir yang dipakai untuk menghitung laju jual */
  windowDays: number
  /** hari tanpa penjualan sampai stok dianggap deadstock */
  deadDays: number
  /** target penjualan per bulan (pcs); kosong = pakai laju jual aktual */
  targetMonthly: number | null
  /** cara hitung safety stock: statistik (Z × σ × √lead time) atau sekian hari penjualan */
  safetyMode: 'stat' | 'days'
  safetyDays: number
}

export const DEFAULT_RESTOCK: RestockParams = { leadDays: 30, reviewDays: 14, service: 0.95, windowDays: 90, deadDays: 90, targetMonthly: null, safetyMode: 'stat', safetyDays: 14 }
export const Z_OF: Record<string, number> = { '0.9': 1.2816, '0.95': 1.6449, '0.99': 2.3263 }

export type RestockStatus = 'pesan' | 'aman' | 'lambat' | 'deadstock' | 'habis'

export interface RestockRow {
  sku: string
  product_code: string
  product_name: string
  color: string
  onHand: number
  inTransit: number
  landed: number
  soldWindow: number
  /** laju jual per hari (sudah diskalakan ke target bila ada) */
  daily: number
  /** simpangan baku penjualan harian */
  sigma: number
  /** stok cukup untuk berapa hari */
  coverDays: number | null
  safety: number
  rop: number
  orderQty: number
  orderCost: number
  lastSale: string | null
  daysSinceSale: number | null
  status: RestockStatus
}

export interface RestockResult {
  asOf: string
  windowFrom: string
  /** total laju jual aktual per bulan di jendela data */
  actualMonthly: number
  /** faktor pengali bila memakai target */
  factor: number
  rows: RestockRow[]
}

const DAY = 86400000
const toDay = (d: string) => Math.floor(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) / DAY)
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)

export function computeRestock(b: DataBundle, p: RestockParams, todayIso: string): RestockResult {
  const stock = computeStock(b).filter((r) => r.tracked && r.category !== 'Kemasan')
  // data penjualan dianggap lengkap sampai tanggal pesanan terakhir
  const lastOrder = b.sales.reduce((a, s) => (s.order_date > a ? s.order_date : a), '')
  const asOfDay = lastOrder ? toDay(lastOrder) : toDay(todayIso)
  const W = Math.max(7, Math.round(p.windowDays))
  const fromD = asOfDay - W + 1
  const series = new Map<string, number[]>()
  for (const s of b.sales) {
    if (!s.sku) continue
    const d = toDay(s.order_date)
    if (d < fromD || d > asOfDay) continue
    let arr = series.get(s.sku)
    if (!arr) series.set(s.sku, (arr = new Array<number>(W).fill(0)))
    arr[d - fromD] += netQty(s)
  }
  const tracked = new Set(stock.map((r) => r.sku))
  const totalWindow = [...series.entries()].filter(([k]) => tracked.has(k)).reduce((a, [, v]) => a + v.reduce((x, y) => x + y, 0), 0)
  const actualMonthly = (totalWindow / W) * 30
  const factor = p.targetMonthly && actualMonthly > 0 ? p.targetMonthly / actualMonthly : 1
  const z = Z_OF[String(p.service)] ?? Z_OF['0.95']
  const L = Math.max(0, p.leadDays)
  const R = Math.max(1, p.reviewDays)
  const rows: RestockRow[] = stock.map((r) => {
    const arr = series.get(r.sku)
    const sold = arr ? arr.reduce((x, y) => x + y, 0) : 0
    const mean = sold / W
    const variance = arr ? arr.reduce((a, v) => a + (v - mean) ** 2, 0) / W : 0
    const daily = Math.max(0, mean) * factor
    // bila penjualan naik karena lebih banyak hari jualan, ragamnya naik sebanding rata-rata (σ naik sebesar √faktor)
    const sigma = Math.sqrt(variance) * Math.sqrt(factor)
    const onHand = Math.max(0, r.onHand)
    const safety = daily <= 0 ? 0 : p.safetyMode === 'days' ? Math.ceil(daily * Math.max(0, p.safetyDays)) : Math.ceil(z * sigma * Math.sqrt(L))
    const rop = daily > 0 ? Math.ceil(daily * L + safety) : 0
    const position = onHand + r.inTransit
    const upTo = daily * (L + R) + safety
    const orderQty = daily > 0 && position <= rop ? Math.max(0, Math.ceil(upTo - position)) : 0
    const daysSinceSale = r.lastSale ? asOfDay - toDay(r.lastSale) : null
    const coverDays = daily > 0 ? onHand / daily : null
    let status: RestockStatus
    if (daily > 0 && position <= rop) status = 'pesan'
    else if (onHand > 0 && (daysSinceSale == null || daysSinceSale > p.deadDays)) status = 'deadstock'
    else if (onHand <= 0) status = 'habis'
    else if (coverDays != null && coverDays > 180) status = 'lambat'
    else status = 'aman'
    return {
      sku: r.sku,
      product_code: r.product_code,
      product_name: r.product_name,
      color: r.color,
      onHand,
      inTransit: r.inTransit,
      landed: r.landed,
      soldWindow: sold,
      daily,
      sigma,
      coverDays,
      safety,
      rop,
      orderQty,
      orderCost: orderQty * r.landed,
      lastSale: r.lastSale,
      daysSinceSale,
      status,
    }
  })
  return { asOf: fromDay(asOfDay), windowFrom: fromDay(fromD), actualMonthly, factor, rows }
}
