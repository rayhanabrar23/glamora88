// Skema database D1. Semua perintah idempoten (IF NOT EXISTS),
// dijalankan otomatis saat API pertama kali dipanggil.
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS stores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    channel TEXT NOT NULL DEFAULT 'TikTok Shop',
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'Tas',
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'Aktif',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS variants (
    sku TEXT PRIMARY KEY,
    product_code TEXT NOT NULL REFERENCES products(code) ON DELETE CASCADE,
    color TEXT NOT NULL,
    price INTEGER,
    active INTEGER NOT NULL DEFAULT 1
  )`,
  `CREATE TABLE IF NOT EXISTS sku_map (
    platform_sku_id TEXT PRIMARY KEY,
    sku TEXT NOT NULL,
    product_name TEXT,
    variation TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL DEFAULT 'manual',
    store TEXT NOT NULL,
    order_id TEXT NOT NULL,
    line_key TEXT NOT NULL,
    order_date TEXT NOT NULL,
    sku TEXT,
    platform_sku_id TEXT,
    product_name TEXT,
    variation TEXT,
    qty INTEGER NOT NULL,
    return_qty INTEGER NOT NULL DEFAULT 0,
    cancel_qty INTEGER NOT NULL DEFAULT 0,
    unit_price REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'Normal',
    weight_kg REAL,
    notes TEXT,
    UNIQUE(store, order_id, line_key)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(order_date)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_sku ON sales(sku)`,
  `CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    order_date TEXT NOT NULL,
    arrival_date TEXT,
    status TEXT NOT NULL DEFAULT 'Dipesan',
    supplier TEXT,
    exchange_rate REAL NOT NULL DEFAULT 0,
    cargo_cost REAL NOT NULL DEFAULT 0,
    other_cost REAL NOT NULL DEFAULT 0,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    qty INTEGER NOT NULL,
    price_cny REAL
  )`,
  `CREATE TABLE IF NOT EXISTS stock_adjustments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adj_date TEXT NOT NULL,
    sku TEXT NOT NULL,
    qty_delta INTEGER NOT NULL,
    reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS boosts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    boost_date TEXT NOT NULL,
    store TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'LIVE',
    title TEXT,
    status TEXT,
    budget REAL NOT NULL DEFAULT 0,
    coupon REAL NOT NULL DEFAULT 0,
    apple_fee REAL NOT NULL DEFAULT 0,
    purchases INTEGER,
    viewers INTEGER,
    views INTEGER,
    notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    exp_date TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    amount REAL NOT NULL,
    classification TEXT NOT NULL DEFAULT 'Tetap',
    cash_only INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS live_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_at TEXT NOT NULL,
    duration_min INTEGER NOT NULL,
    store TEXT NOT NULL,
    host TEXT,
    title TEXT,
    viewers INTEGER,
    notes TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_live_start ON live_sessions(start_at)`,
  `CREATE TABLE IF NOT EXISTS settlements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    store TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'Order',
    settled_at TEXT,
    order_created_at TEXT,
    revenue REAL NOT NULL DEFAULT 0,
    fees REAL NOT NULL DEFAULT 0,
    amount REAL NOT NULL DEFAULT 0,
    details TEXT,
    UNIQUE(store, ref_id, kind)
  )`,
]

export const DEFAULT_SETTINGS: Record<string, string> = {
  platform_commission_pct: '0.10',
  dynamic_commission_pct: '0.06',
  order_processing_fee: '1250',
  heavy_parcel_fee: '10000',
  heavy_parcel_threshold_kg: '0.3',
  heavy_parcel_share_fallback: '0.082',
  fallback_landed_cost: '120000',
  business_name: 'Glamora88',
  live_attribution_buffer_min: '15',
}
