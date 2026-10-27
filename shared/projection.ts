// Proyeksi arus kas bulanan berdasarkan asumsi yang bisa diubah pengguna.

export interface CostItem {
  id: string
  name: string
  amount: number
  from: string // YYYY-MM
  to?: string // YYYY-MM (opsional)
}

export interface OneOff {
  id: string
  name: string
  month: string
  amount: number // positif = uang keluar, negatif = uang masuk (mis. suntikan modal)
}

export interface Restock {
  id: string
  month: string
  pcs: number
  costPerPcs: number
}

export interface Scenario {
  start: string
  months: number
  openingCash: number
  openingStock: number
  price: number
  landedCost: number
  commissionPct: number // komisi TikTok (platform + dinamis)
  perOrderFee: number // biaya pemrosesan + rata-rata fee paket berat per pesanan
  teamCommissionPerPcs: number
  pcsPerOrder: number
  volume: Record<string, number> // pcs neto per bulan
  costs: CostItem[]
  oneOffs: OneOff[]
  restocks: Restock[]
}

export interface ProjectionRow {
  month: string
  pcs: number
  sellablePcs: number
  stockShort: number
  omzet: number
  platformFees: number
  teamCommission: number
  hpp: number
  fixedCosts: number
  oneOff: number
  purchases: number
  operatingProfit: number
  cashIn: number
  cashOut: number
  netCash: number
  cashEnd: number
  stockEnd: number
}

export interface ProjectionResult {
  rows: ProjectionRow[]
  lowestCash: number
  lowestMonth: string | null
  fundingNeed: number
  firstProfitMonth: string | null
  totalProfit: number
  stockOutMonth: string | null
  endCash: number
}

export function addMonths(ym: string, n: number) {
  let [y, m] = ym.split('-').map(Number)
  m += n
  y += Math.floor((m - 1) / 12)
  m = ((((m - 1) % 12) + 12) % 12) + 1
  return `${y}-${String(m).padStart(2, '0')}`
}

export function projectionMonths(s: Pick<Scenario, 'start' | 'months'>) {
  return Array.from({ length: s.months }, (_, i) => addMonths(s.start, i))
}

const active = (c: { from: string; to?: string }, m: string) => m >= c.from && (!c.to || m <= c.to)

export function runProjection(s: Scenario): ProjectionResult {
  let cash = s.openingCash
  let stock = s.openingStock
  const rows: ProjectionRow[] = []
  for (const m of projectionMonths(s)) {
    const incoming = s.restocks.filter((r) => r.month === m)
    const purchases = incoming.reduce((a, r) => a + r.pcs * r.costPerPcs, 0)
    stock += incoming.reduce((a, r) => a + r.pcs, 0)
    const wanted = Math.max(0, s.volume[m] ?? 0)
    const pcs = Math.min(wanted, Math.max(0, stock)) // tidak bisa menjual melebihi stok
    stock -= pcs
    const omzet = pcs * s.price
    const orders = s.pcsPerOrder > 0 ? pcs / s.pcsPerOrder : pcs
    const platformFees = omzet * s.commissionPct + orders * s.perOrderFee
    const teamCommission = pcs * s.teamCommissionPerPcs
    const hpp = pcs * s.landedCost
    const fixedCosts = s.costs.filter((c) => active(c, m)).reduce((a, c) => a + c.amount, 0)
    const oneOff = s.oneOffs.filter((o) => o.month === m).reduce((a, o) => a + o.amount, 0)
    const cashIn = omzet - platformFees
    const cashOut = teamCommission + fixedCosts + oneOff + purchases
    const netCash = cashIn - cashOut
    cash += netCash
    rows.push({
      month: m,
      pcs,
      sellablePcs: pcs,
      stockShort: wanted - pcs,
      omzet,
      platformFees,
      teamCommission,
      hpp,
      fixedCosts,
      oneOff,
      purchases,
      operatingProfit: omzet - platformFees - teamCommission - hpp - fixedCosts,
      cashIn,
      cashOut,
      netCash,
      cashEnd: cash,
      stockEnd: stock,
    })
  }
  const low = rows.reduce<ProjectionRow | null>((a, r) => (!a || r.cashEnd < a.cashEnd ? r : a), null)
  const lowestCash = Math.min(s.openingCash, low?.cashEnd ?? s.openingCash)
  return {
    rows,
    lowestCash,
    lowestMonth: low && low.cashEnd < s.openingCash ? low.month : null,
    fundingNeed: Math.max(0, -lowestCash),
    firstProfitMonth: rows.find((r) => r.operatingProfit > 0)?.month ?? null,
    totalProfit: rows.reduce((a, r) => a + r.operatingProfit, 0),
    stockOutMonth: rows.find((r) => r.stockShort > 0)?.month ?? null,
    endCash: rows.length ? rows[rows.length - 1].cashEnd : s.openingCash,
  }
}
