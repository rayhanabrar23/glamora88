export type SaleStatus = 'Normal' | 'Retur' | 'Retur tidak jadi' | 'Cancel ditolak' | 'Batal'

export const SALE_STATUSES: SaleStatus[] = ['Normal', 'Retur', 'Retur tidak jadi', 'Cancel ditolak', 'Batal']

export const EXPENSE_CATEGORIES = [
  'Gaji',
  'Komisi',
  'Sewa',
  'Listrik',
  'IPL',
  'Transport',
  'Kemasan',
  'Marketing lain',
  'Peralatan',
  'Lainnya',
] as const

export const CLASSIFICATIONS = ['Tetap', 'Tetap (diskresioner)', 'Semi-variabel', 'Variabel'] as const
export type Classification = (typeof CLASSIFICATIONS)[number]

export const PURCHASE_STATUSES = ['Dipesan', 'Dalam perjalanan', 'Tiba'] as const

export const PRODUCT_CATEGORIES = ['Tas', 'Dompet', 'Aksesoris', 'Kemasan'] as const

export interface Store {
  id: number
  name: string
  channel: string
  active: number
}

export interface Product {
  code: string
  name: string
  category: string
  reference: string | null
  status: string
  notes: string | null
}

export interface Variant {
  sku: string
  product_code: string
  color: string
  price: number | null
  active: number
}

export interface Sale {
  id: number
  source: string
  store: string
  order_id: string
  line_key: string
  order_date: string
  sku: string | null
  platform_sku_id: string | null
  product_name: string | null
  variation: string | null
  qty: number
  return_qty: number
  cancel_qty: number
  unit_price: number
  status: SaleStatus
  weight_kg: number | null
  notes: string | null
}

export interface Purchase {
  id: number
  name: string
  order_date: string
  arrival_date: string | null
  status: string
  supplier: string | null
  exchange_rate: number
  cargo_cost: number
  other_cost: number
  notes: string | null
}

export interface PurchaseItem {
  id: number
  purchase_id: number
  sku: string
  qty: number
  price_cny: number | null
}

export interface StockAdjustment {
  id: number
  adj_date: string
  sku: string
  qty_delta: number
  reason: string | null
}

export interface Boost {
  id: number
  boost_date: string
  store: string
  kind: string
  title: string | null
  status: string | null
  budget: number
  coupon: number
  apple_fee: number
  purchases: number | null
  viewers: number | null
  views: number | null
  notes: string | null
}

export interface Expense {
  id: number
  exp_date: string
  category: string
  description: string | null
  amount: number
  classification: Classification
  cash_only: number
}

/** Baris penjualan hasil normalisasi file export (sebelum disimpan). */
export interface ImportedSaleLine {
  order_id: string
  line_key: string
  order_date: string
  platform_sku_id: string | null
  seller_sku: string | null
  product_name: string | null
  variation: string | null
  qty: number
  return_qty: number
  cancel_qty: number
  unit_price: number
  status: SaleStatus
  weight_kg: number | null
}
