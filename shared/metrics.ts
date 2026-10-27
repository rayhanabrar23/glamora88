// Perhitungan kinerja bisnis. Dipakai oleh API (server) dan bisa diuji di Node.
import type { Boost, Expense, Product, Purchase, PurchaseItem, Sale, StockAdjustment, Variant } from './types'

export interface DataBundle {
  settings: Record<string, string>
  products: Product[]
  variants: Variant[]
  sales: Sale[]
  purchases: Purchase[]
  purchaseItems: PurchaseItem[]
  adjustments: StockAdjustment[]
  boosts: Boost[]
  expenses: Expense[]
}

const n = (v: unknown, d = 0) => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : d
}

export const monthKey = (d: string) => d.slice(0, 7)

export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  let [y, m] = from.split('-').map(Number)
  const [ty, tm] = to.split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m++
    if (m > 12) {
      m = 1
      y++
    }
  }
  return out
}

export const netQty = (s: Pick<Sale, 'qty' | 'return_qty' | 'cancel_qty'>) => s.qty - s.return_qty - s.cancel_qty
export const boostCost = (b: Pick<Boost, 'budget' | 'coupon' | 'apple_fee'>) => b.budget - b.coupon + b.apple_fee

/** Landed cost per pcs per pembelian (harga CNY × kurs + porsi cargo & biaya lain). */
export function landedCosts(purchases: Purchase[], items: PurchaseItem[], fallback: number) {
  const perItem = new Map<number, number>()
  const byPurchase = new Map<number, PurchaseItem[]>()
  for (const it of items) {
    const arr = byPurchase.get(it.purchase_id) ?? []
    arr.push(it)
    byPurchase.set(it.purchase_id, arr)
  }
  for (const p of purchases) {
    const its = byPurchase.get(p.id) ?? []
    const totalQty = its.reduce((a, b) => a + b.qty, 0)
    const overhead = totalQty > 0 ? (n(p.cargo_cost) + n(p.other_cost)) / totalQty : 0
    for (const it of its) {
      const base = it.price_cny != null && n(p.exchange_rate) > 0 ? n(it.price_cny) * n(p.exchange_rate) : fallback - overhead
      perItem.set(it.id, base + overhead)
    }
  }
  return perItem
}

export interface SkuCost {
  landed: number
  tracked: boolean
}

export function skuCostMap(b: DataBundle): Map<string, SkuCost> {
  const fallback = n(b.settings.fallback_landed_cost, 120000)
  const perItem = landedCosts(b.purchases, b.purchaseItems, fallback)
  const acc = new Map<string, { qty: number; cost: number }>()
  for (const it of b.purchaseItems) {
    const a = acc.get(it.sku) ?? { qty: 0, cost: 0 }
    a.qty += it.qty
    a.cost += it.qty * (perItem.get(it.id) ?? fallback)
    acc.set(it.sku, a)
  }
  const catOf = new Map(b.products.map((p) => [p.code, p.category]))
  const prodOf = new Map(b.variants.map((v) => [v.sku, v.product_code]))
  const out = new Map<string, SkuCost>()
  const allSkus = new Set<string>([...b.variants.map((v) => v.sku), ...acc.keys()])
  for (const sku of allSkus) {
    const a = acc.get(sku)
    const cat = catOf.get(prodOf.get(sku) ?? '') ?? 'Tas'
    if (a && a.qty > 0) out.set(sku, { landed: a.cost / a.qty, tracked: true })
    else out.set(sku, { landed: cat === 'Kemasan' ? 0 : fallback, tracked: cat !== 'Kemasan' })
  }
  return out
}

export interface MonthRow {
  month: string
  omzetGross: number
  omzetNet: number
  omzetByStore: Record<string, number>
  pcsNet: number
  orders: number
  returnsQty: number
  hpp: number
  platformFees: number
  contribution: number
  boost: number
  fixedCosts: number
  variableExpenses: number
  operatingProfit: number
  cashIn: number
  cashOutOps: number
  cashPurchases: number
  netCash: number
  cumulativeCash: number
}

export interface StockRow {
  sku: string
  product_code: string
  product_name: string
  category: string
  color: string
  arrived: number
  inTransit: number
  soldNet: number
  returned: number
  adjustments: number
  onHand: number
  landed: number
  value: number
  sellThrough: number | null
  lastSale: string | null
  tracked: boolean
}

export function computeStock(b: DataBundle): StockRow[] {
  const costs = skuCostMap(b)
  const status = new Map(b.purchases.map((p) => [p.id, p.status]))
  const prod = new Map(b.products.map((p) => [p.code, p]))
  const rows = new Map<string, StockRow>()
  const ensure = (sku: string) => {
    let r = rows.get(sku)
    if (!r) {
      const v = b.variants.find((x) => x.sku === sku)
      const p = prod.get(v?.product_code ?? '')
      const c = costs.get(sku)
      r = {
        sku,
        product_code: v?.product_code ?? '—',
        product_name: p?.name ?? 'Belum dipetakan',
        category: p?.category ?? 'Tas',
        color: v?.color ?? '',
        arrived: 0,
        inTransit: 0,
        soldNet: 0,
        returned: 0,
        adjustments: 0,
        onHand: 0,
        landed: c?.landed ?? n(b.settings.fallback_landed_cost, 120000),
        value: 0,
        sellThrough: null,
        lastSale: null,
        tracked: c?.tracked ?? true,
      }
      rows.set(sku, r)
    }
    return r
  }
  for (const v of b.variants) ensure(v.sku)
  for (const it of b.purchaseItems) {
    const r = ensure(it.sku)
    if (status.get(it.purchase_id) === 'Tiba') r.arrived += it.qty
    else r.inTransit += it.qty
  }
  for (const s of b.sales) {
    if (!s.sku) continue
    const r = ensure(s.sku)
    r.soldNet += netQty(s)
    r.returned += s.return_qty
    if (netQty(s) > 0 && (!r.lastSale || s.order_date > r.lastSale)) r.lastSale = s.order_date
  }
  for (const a of b.adjustments) ensure(a.sku).adjustments += a.qty_delta
  for (const r of rows.values()) {
    r.onHand = r.arrived - r.soldNet + r.adjustments
    r.value = Math.max(0, r.onHand) * r.landed
    r.sellThrough = r.arrived > 0 ? r.soldNet / r.arrived : null
  }
  return [...rows.values()].sort((a, b2) => a.sku.localeCompare(b2.sku))
}

export function computeMonthly(b: DataBundle, from?: string, to?: string): MonthRow[] {
  const s = b.settings
  const commission = n(s.platform_commission_pct, 0.1) + n(s.dynamic_commission_pct, 0.06)
  const procFee = n(s.order_processing_fee, 1250)
  const heavyFee = n(s.heavy_parcel_fee, 10000)
  const heavyKg = n(s.heavy_parcel_threshold_kg, 0.3)
  const heavyShare = n(s.heavy_parcel_share_fallback, 0.082)
  const costs = skuCostMap(b)
  const cat = new Map(b.products.map((p) => [p.code, p.category]))
  const prodOf = new Map(b.variants.map((v) => [v.sku, v.product_code]))
  const fallback = n(s.fallback_landed_cost, 120000)

  const allMonths = [
    ...b.sales.map((x) => monthKey(x.order_date)),
    ...b.expenses.map((x) => monthKey(x.exp_date)),
    ...b.boosts.map((x) => monthKey(x.boost_date)),
    ...b.purchases.map((x) => monthKey(x.order_date)),
  ].sort()
  if (!allMonths.length) return []
  const start = from ?? allMonths[0]
  const end = to ?? allMonths[allMonths.length - 1]
  const months = monthRange(start, end)
  const rows = new Map<string, MonthRow>(
    months.map((m) => [
      m,
      {
        month: m,
        omzetGross: 0,
        omzetNet: 0,
        omzetByStore: {},
        pcsNet: 0,
        orders: 0,
        returnsQty: 0,
        hpp: 0,
        platformFees: 0,
        contribution: 0,
        boost: 0,
        fixedCosts: 0,
        variableExpenses: 0,
        operatingProfit: 0,
        cashIn: 0,
        cashOutOps: 0,
        cashPurchases: 0,
        netCash: 0,
        cumulativeCash: 0,
      },
    ]),
  )

  // Penjualan & biaya platform per pesanan
  const orderAgg = new Map<string, { month: string; net: number; weight: number | null }>()
  for (const x of b.sales) {
    const r = rows.get(monthKey(x.order_date))
    if (!r) continue
    const net = netQty(x)
    const isPack = cat.get(prodOf.get(x.sku ?? '') ?? '') === 'Kemasan'
    r.omzetGross += (x.qty - x.cancel_qty) * x.unit_price
    r.omzetNet += net * x.unit_price
    r.omzetByStore[x.store] = (r.omzetByStore[x.store] ?? 0) + net * x.unit_price
    if (!isPack) r.pcsNet += net
    r.returnsQty += x.return_qty
    r.hpp += net * (x.sku ? costs.get(x.sku)?.landed ?? fallback : fallback)
    r.platformFees += net * x.unit_price * commission
    const key = `${x.store}|${x.order_id}`
    const o = orderAgg.get(key) ?? { month: r.month, net: 0, weight: null }
    o.net += isPack ? 0 : net
    if (x.weight_kg != null) o.weight = Math.max(o.weight ?? 0, x.weight_kg)
    orderAgg.set(key, o)
  }
  for (const o of orderAgg.values()) {
    if (o.net <= 0) continue
    const r = rows.get(o.month)!
    r.orders += 1
    r.platformFees += procFee + (o.weight == null ? heavyFee * heavyShare : o.weight > heavyKg ? heavyFee : 0)
  }
  for (const x of b.boosts) {
    const r = rows.get(monthKey(x.boost_date))
    if (r) r.boost += boostCost(x)
  }
  for (const x of b.expenses) {
    const r = rows.get(monthKey(x.exp_date))
    if (!r) continue
    r.cashOutOps += x.amount
    if (x.cash_only) continue
    if (x.classification === 'Variabel') r.variableExpenses += x.amount
    else r.fixedCosts += x.amount
  }
  const pCost = new Map<number, number>()
  const perItem = landedCosts(b.purchases, b.purchaseItems, fallback)
  for (const it of b.purchaseItems) pCost.set(it.purchase_id, (pCost.get(it.purchase_id) ?? 0) + it.qty * (perItem.get(it.id) ?? fallback))
  for (const p of b.purchases) {
    const r = rows.get(monthKey(p.order_date))
    if (r) r.cashPurchases += pCost.get(p.id) ?? n(p.cargo_cost) + n(p.other_cost)
  }
  let cum = 0
  for (const r of rows.values()) {
    r.contribution = r.omzetNet - r.hpp - r.platformFees - r.variableExpenses
    r.operatingProfit = r.contribution - r.fixedCosts - r.boost
    r.cashIn = r.omzetNet - r.platformFees
    r.cashOutOps += r.boost
    r.netCash = r.cashIn - r.cashOutOps - r.cashPurchases
    cum += r.netCash
    r.cumulativeCash = cum
  }
  return [...rows.values()]
}

export interface ModelRow {
  code: string
  name: string
  pcsNet: number
  omzetNet: number
  returns: number
  grossQty: number
}

export function computeByModel(b: DataBundle, from?: string, to?: string): ModelRow[] {
  const prodOf = new Map(b.variants.map((v) => [v.sku, v.product_code]))
  const name = new Map(b.products.map((p) => [p.code, p.name]))
  const cat = new Map(b.products.map((p) => [p.code, p.category]))
  const acc = new Map<string, ModelRow>()
  for (const x of b.sales) {
    const m = monthKey(x.order_date)
    if ((from && m < from) || (to && m > to)) continue
    const code = prodOf.get(x.sku ?? '') ?? 'Belum dipetakan'
    if (cat.get(code) === 'Kemasan') continue
    const r = acc.get(code) ?? { code, name: name.get(code) ?? 'Belum dipetakan', pcsNet: 0, omzetNet: 0, returns: 0, grossQty: 0 }
    r.pcsNet += netQty(x)
    r.omzetNet += netQty(x) * x.unit_price
    r.returns += x.return_qty
    r.grossQty += x.qty - x.cancel_qty
    acc.set(code, r)
  }
  return [...acc.values()].sort((a, c) => c.omzetNet - a.omzetNet)
}
