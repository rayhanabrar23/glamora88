// Rencana restock bulanan per SKU: target pcs per bulan dibagi ke SKU menurut porsi lakunya.
export interface SkuShareInput {
  sku: string
  /** penjualan di jendela data (pcs) — dasar porsi */
  sold: number
  /** stok di gudang + dalam perjalanan */
  stock: number
  landed: number
  /** SKU tidak direstock (deadstock / lambat), tapi stoknya tetap terjual */
  skip: boolean
}

export interface SkuPlanLine {
  month: string
  sku: string
  pcs: number
  costPerPcs: number
}

export interface SkuPlanOptions {
  /** stok pengaman sebagai persen kebutuhan bulan berikutnya (0,35 = 35%) */
  safetyPct: number
  /** pembulatan ke atas per SKU, mis. 5 */
  roundTo: number
}

/**
 * Untuk tiap bulan: kebutuhan SKU = target bulan itu × porsi SKU.
 * Restock = kebutuhan bulan ini + stok pengaman (persen kebutuhan bulan depan) − stok yang ada.
 * Barang restock dianggap siap dijual di bulan yang sama (sama dengan cara hitung proyeksi).
 */
export function planRestockBySku(months: string[], volume: Record<string, number>, skus: SkuShareInput[], o: SkuPlanOptions): SkuPlanLine[] {
  const total = skus.reduce((a, s) => a + Math.max(0, s.sold), 0)
  if (total <= 0) return []
  const step = Math.max(1, Math.round(o.roundTo) || 1)
  const out: SkuPlanLine[] = []
  for (const s of skus) {
    const share = Math.max(0, s.sold) / total
    if (share <= 0) continue
    let stock = Math.max(0, s.stock)
    months.forEach((m, i) => {
      const need = (volume[m] ?? 0) * share
      const nextNeed = (volume[months[i + 1]] ?? volume[m] ?? 0) * share
      let qty = 0
      if (!s.skip) {
        const gap = need + nextNeed * Math.max(0, o.safetyPct) - stock
        if (gap > 0) qty = Math.ceil(gap / step) * step
      }
      if (qty > 0) out.push({ month: m, sku: s.sku, pcs: qty, costPerPcs: Math.round(s.landed) })
      stock = Math.max(0, stock + qty - need)
    })
  }
  return out.sort((a, b) => a.month.localeCompare(b.month) || b.pcs - a.pcs)
}
