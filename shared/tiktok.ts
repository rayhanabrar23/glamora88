// Membaca file export "Order SKU List" TikTok Shop dan menormalkan statusnya.
// Aturan status (disepakati dengan owner, Okt 2026):
//  - Return/Refund dengan qty retur > 0            → Retur (barang & uang kembali)
//  - Return/Refund dengan qty retur 0               → Retur tidak jadi (tetap terjual)
//  - Cancel tanpa "Cancelled Time" & sudah terkirim → Cancel ditolak (tetap terjual)
//  - Cancel lainnya                                 → Batal (tidak dihitung terjual)
import type { ImportedSaleLine, SaleStatus } from './types'

type Cell = string | number | boolean | Date | null | undefined

const pad = (v: number) => String(v).padStart(2, '0')

export function toIsoDateTime(v: Cell): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`
  }
  if (typeof v === 'number') {
    // nomor seri tanggal Excel
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  }
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return `${m[3]}-${pad(+m[2])}-${pad(+m[1])} ${pad(+(m[4] ?? 0))}:${m[5] ?? '00'}:${m[6] ?? '00'}`
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/)
  if (m) return `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? '00'}:${m[5] ?? '00'}:${m[6] ?? '00'}`
  return null
}

const toNum = (v: Cell) => {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const s = String(v).replace(/[^\d.,-]/g, '')
  const x = parseFloat(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''))
  return Number.isFinite(x) ? x : 0
}

const text = (v: Cell) => (v == null || v === '' ? null : String(v).trim())

export interface ParseResult {
  lines: ImportedSaleLine[]
  skipped: number
  warnings: string[]
  dateRange: [string, string] | null
}

const REQUIRED = ['Order ID', 'Quantity', 'Created Time']

export function parseTikTokRows(rows: Cell[][]): ParseResult {
  const warnings: string[] = []
  const headerIdx = rows.findIndex((r) => r.some((c) => String(c ?? '').trim() === 'Order ID'))
  if (headerIdx < 0) throw new Error('Kolom "Order ID" tidak ditemukan. Pastikan file adalah export Order dari TikTok Seller Center.')
  const header = rows[headerIdx].map((c) => String(c ?? '').trim())
  const col = (name: string) => header.indexOf(name)
  for (const r of REQUIRED) if (col(r) < 0) throw new Error(`Kolom "${r}" tidak ditemukan di file.`)

  const idx = {
    order: col('Order ID'),
    type: col('Cancelation/Return Type'),
    skuId: col('SKU ID'),
    sellerSku: col('Seller SKU'),
    product: col('Product Name'),
    variation: col('Variation'),
    qty: col('Quantity'),
    ret: col('Sku Quantity of return'),
    unit: col('SKU Unit Original Price'),
    before: col('SKU Subtotal Before Discount'),
    sellerDisc: col('SKU Seller Discount'),
    created: col('Created Time'),
    delivered: col('Delivered Time'),
    cancelled: col('Cancelled Time'),
    weight: col('Weight(kg)'),
  }
  const get = (r: Cell[], i: number) => (i >= 0 ? r[i] : null)

  const lines: ImportedSaleLine[] = []
  const seen = new Map<string, number>()
  let skipped = 0
  for (const r of rows.slice(headerIdx + 1)) {
    const orderId = String(get(r, idx.order) ?? '').trim()
    if (!/^\d{6,}$/.test(orderId)) {
      if (orderId) skipped++
      continue
    }
    const qty = Math.round(toNum(get(r, idx.qty)))
    if (qty <= 0) {
      skipped++
      continue
    }
    const created = toIsoDateTime(get(r, idx.created))
    if (!created) {
      skipped++
      warnings.push(`Order ${orderId}: tanggal tidak terbaca, dilewati.`)
      continue
    }
    const before = idx.before >= 0 ? toNum(get(r, idx.before)) : toNum(get(r, idx.unit)) * qty
    const unitPrice = (before - toNum(get(r, idx.sellerDisc))) / qty
    const type = String(get(r, idx.type) ?? '').trim()
    const retQty = Math.min(qty, Math.round(toNum(get(r, idx.ret))))
    const cancelledAt = text(get(r, idx.cancelled))
    const deliveredAt = text(get(r, idx.delivered))
    let status: SaleStatus = 'Normal'
    let returnQty = 0
    let cancelQty = 0
    if (/return|refund/i.test(type)) {
      if (retQty > 0) {
        status = 'Retur'
        returnQty = retQty
      } else status = 'Retur tidak jadi'
    } else if (/cancel/i.test(type)) {
      if (!cancelledAt && deliveredAt) status = 'Cancel ditolak'
      else {
        status = 'Batal'
        cancelQty = qty
      }
    }
    const skuId = text(get(r, idx.skuId))
    const base = skuId ?? `${text(get(r, idx.product))}|${text(get(r, idx.variation))}`
    const k = `${orderId}|${base}`
    const dup = (seen.get(k) ?? 0) + 1
    seen.set(k, dup)
    const w = toNum(get(r, idx.weight))
    lines.push({
      order_id: orderId,
      line_key: dup > 1 ? `${base}#${dup}` : base,
      order_date: created,
      platform_sku_id: skuId,
      seller_sku: text(get(r, idx.sellerSku)),
      product_name: text(get(r, idx.product)),
      variation: text(get(r, idx.variation)),
      qty,
      return_qty: returnQty,
      cancel_qty: cancelQty,
      unit_price: Math.round(unitPrice * 100) / 100,
      status,
      weight_kg: w > 0 ? w : null,
    })
  }
  const dates = lines.map((l) => l.order_date).sort()
  return { lines, skipped, warnings, dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null }
}

/** Parser CSV sederhana (mendukung tanda kutip). */
export function parseCsv(textIn: string): string[][] {
  const out: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  const delim = (textIn.split('\n')[0].match(/;/g)?.length ?? 0) > (textIn.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ','
  for (let i = 0; i < textIn.length; i++) {
    const ch = textIn[i]
    if (q) {
      if (ch === '"' && textIn[i + 1] === '"') {
        cur += '"'
        i++
      } else if (ch === '"') q = false
      else cur += ch
    } else if (ch === '"') q = true
    else if (ch === delim) {
      row.push(cur)
      cur = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && textIn[i + 1] === '\n') i++
      row.push(cur)
      out.push(row)
      row = []
      cur = ''
    } else cur += ch
  }
  if (cur || row.length) {
    row.push(cur)
    out.push(row)
  }
  return out
}
