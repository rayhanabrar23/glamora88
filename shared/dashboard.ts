import { boostCost, computeByModel, computeMonthly, computeStock, monthKey, netQty, type DataBundle, type MonthRow } from './metrics'

export interface Insight {
  tone: 'good' | 'warning' | 'critical' | 'info'
  title: string
  detail: string
}

export interface DashboardData {
  period: { from: string; to: string; months: number; activeMonths: number }
  stores: string[]
  kpi: {
    omzetNet: number
    pcsNet: number
    orders: number
    avgPrice: number
    returnRate: number
    operatingProfit: number
    contributionPct: number
    stockValue: number
    stockUnits: number
    boostSpend: number
  }
  bep: {
    fixedPerMonth: number
    contributionPct: number
    bepOmzet: number | null
    bepPcs: number | null
    actualOmzetPerMonth: number
    progress: number | null
    plannedFixed: number | null
    plannedBepOmzet: number | null
    plannedBepPcs: number | null
  }
  monthly: MonthRow[]
  byModel: ReturnType<typeof computeByModel>
  stockByModel: { code: string; name: string; onHand: number; soldNet: number; value: number; inTransit: number }[]
  insights: Insight[]
}

export function buildDashboard(b: DataBundle, from?: string, to?: string, store?: string): DashboardData {
  const scoped: DataBundle = store
    ? { ...b, sales: b.sales.filter((s) => s.store === store), boosts: b.boosts.filter((x) => x.store === store) }
    : b
  const monthly = computeMonthly(scoped, from, to)
  const f = from ?? monthly[0]?.month ?? ''
  const t = to ?? monthly[monthly.length - 1]?.month ?? ''
  const sum = (k: keyof MonthRow) => monthly.reduce((a, r) => a + (r[k] as number), 0)
  const omzetNet = sum('omzetNet')
  const pcsNet = sum('pcsNet')
  const hpp = sum('hpp')
  const fees = sum('platformFees')
  const varExp = sum('variableExpenses')
  const contribution = omzetNet - hpp - fees - varExp
  const contributionPct = omzetNet > 0 ? contribution / omzetNet : 0
  const active = monthly.filter((r) => r.omzetNet > 0 || r.fixedCosts > 0)
  const activeMonths = active.length || 1
  const fixedPerMonth = active.reduce((a, r) => a + r.fixedCosts + r.boost, 0) / activeMonths
  const salesInPeriod = scoped.sales.filter((x) => {
    const m = monthKey(x.order_date)
    return (!f || m >= f) && (!t || m <= t)
  })
  const grossQty = salesInPeriod.reduce((a, x) => a + x.qty - x.cancel_qty, 0)
  const returns = salesInPeriod.reduce((a, x) => a + x.return_qty, 0)
  const avgPrice = pcsNet > 0 ? omzetNet / pcsNet : 0
  const bepOmzet = contributionPct > 0 ? fixedPerMonth / contributionPct : null
  const plannedFixed = parseFloat(b.settings.planned_fixed_cost ?? '') || null

  const stock = computeStock(b)
  const tracked = stock.filter((r) => r.tracked)
  const byCode = new Map<string, { code: string; name: string; onHand: number; soldNet: number; value: number; inTransit: number }>()
  for (const r of tracked) {
    const x = byCode.get(r.product_code) ?? { code: r.product_code, name: r.product_name, onHand: 0, soldNet: 0, value: 0, inTransit: 0 }
    x.onHand += r.onHand
    x.soldNet += r.soldNet
    x.value += r.value
    x.inTransit += r.inTransit
    byCode.set(r.product_code, x)
  }
  const stockByModel = [...byCode.values()].sort((a, c) => c.onHand - a.onHand)
  const stockUnits = tracked.reduce((a, r) => a + Math.max(0, r.onHand), 0)
  const stockValue = tracked.reduce((a, r) => a + r.value, 0)

  // Catatan otomatis
  const insights: Insight[] = []
  const actualPerMonth = omzetNet / activeMonths
  if (bepOmzet) {
    const p = actualPerMonth / bepOmzet
    insights.push({
      tone: p >= 1 ? 'good' : p >= 0.7 ? 'warning' : 'critical',
      title: p >= 1 ? 'Penjualan sudah di atas titik impas' : 'Penjualan masih di bawah titik impas',
      detail: `Rata-rata omzet ${fmtJt(actualPerMonth)}/bulan, titik impas ${fmtJt(bepOmzet)}/bulan (${Math.round(p * 100)}%).`,
    })
  }
  const monthsAvg = pcsNet / activeMonths
  if (monthsAvg > 0 && stockUnits > 0) {
    const cover = stockUnits / monthsAvg
    if (cover > 4)
      insights.push({
        tone: 'warning',
        title: `Stok cukup untuk ±${Math.round(cover)} bulan`,
        detail: `${stockUnits.toLocaleString('id-ID')} pcs (≈ ${fmtJt(stockValue)}) di gudang dengan laju jual ±${Math.round(monthsAvg)} pcs/bulan. Tahan restock model yang lambat.`,
      })
  }
  const dead = stockByModel.filter((m) => m.onHand > 0 && m.soldNet <= 0)
  if (dead.length)
    insights.push({
      tone: 'warning',
      title: `${dead.length} model belum pernah terjual`,
      detail: dead.map((d) => `${d.code} ${d.name} (${d.onHand} pcs)`).join(', '),
    })
  const negative = stock.filter((r) => r.tracked && r.onHand < 0)
  if (negative.length)
    insights.push({
      tone: 'info',
      title: 'Ada SKU dengan stok minus',
      detail: `${negative.map((r) => r.sku).join(', ')}: terjual lebih banyak dari pembelian yang tercatat. Catat pembeliannya atau lakukan stock opname.`,
    })
  const rr = grossQty > 0 ? returns / grossQty : 0
  if (rr > 0.08)
    insights.push({ tone: 'warning', title: `Tingkat retur ${(rr * 100).toFixed(1)}%`, detail: 'Cek alasan retur di Seller Center; retur di atas 8% menggerus omzet dan waktu admin.' })
  const boostsInPeriod = scoped.boosts.filter((x) => (!f || monthKey(x.boost_date) >= f) && (!t || monthKey(x.boost_date) <= t))
  const boostTotal = boostsInPeriod.reduce((a, x) => a + boostCost(x), 0)
  const appleFee = boostsInPeriod.reduce((a, x) => a + x.apple_fee, 0)
  if (appleFee > 0 && boostTotal > 0 && appleFee / boostTotal > 0.15)
    insights.push({
      tone: 'info',
      title: `${Math.round((appleFee / boostTotal) * 100)}% biaya boost habis untuk Apple fee`,
      detail: 'Top up koin promosi lewat browser atau Android biasanya tidak dikenai Apple service fee.',
    })
  const lastMonth = monthly[monthly.length - 1]
  if (lastMonth && lastMonth.omzetNet === 0 && monthly.length > 1)
    insights.push({ tone: 'critical', title: 'Tidak ada penjualan di bulan terakhir', detail: 'Pastikan jadwal live dan stok siap jual.' })

  return {
    period: { from: f, to: t, months: monthly.length, activeMonths },
    stores: [...new Set(b.sales.map((s) => s.store))],
    kpi: {
      omzetNet,
      pcsNet,
      orders: sum('orders'),
      avgPrice,
      returnRate: rr,
      operatingProfit: sum('operatingProfit'),
      contributionPct,
      stockValue,
      stockUnits,
      boostSpend: boostTotal,
    },
    bep: {
      fixedPerMonth,
      contributionPct,
      bepOmzet,
      bepPcs: bepOmzet && avgPrice ? bepOmzet / avgPrice : null,
      actualOmzetPerMonth: actualPerMonth,
      progress: bepOmzet ? actualPerMonth / bepOmzet : null,
      plannedFixed,
      plannedBepOmzet: plannedFixed && contributionPct > 0 ? plannedFixed / contributionPct : null,
      plannedBepPcs: plannedFixed && contributionPct > 0 && avgPrice ? plannedFixed / contributionPct / avgPrice : null,
    },
    monthly,
    byModel: computeByModel(scoped, f, t),
    stockByModel,
    insights,
  }
}

function fmtJt(v: number) {
  return `Rp${(v / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
}

export { netQty }
