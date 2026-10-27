// Membaca laporan Settlement / Income TikTok Shop. Format kolom bisa berubah,
// jadi kolom dikenali dari namanya (Bahasa Inggris maupun Indonesia).
import { toIsoDateTime } from './tiktok'

type Cell = string | number | boolean | Date | null | undefined

export interface SettlementLine {
  ref_id: string
  kind: string
  settled_at: string | null
  order_created_at: string | null
  revenue: number
  fees: number // positif = potongan
  amount: number // dana cair
  details: Record<string, number>
}

export interface SettlementParse {
  lines: SettlementLine[]
  columns: { id: string; amount: string; revenue: string | null; fees: string | null; settled: string | null; details: string[] }
  skipped: number
  dateRange: [string, string] | null
}

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')

const ID = [/^order\/adjustment id$/, /^order id$/, /^order\/adjustment id\b/, /^id pesanan/, /^id pesanan\/penyesuaian/, /adjustment id/, /^order number$/]
const AMOUNT = [/^total settlement amount$/, /^settlement amount$/, /jumlah penyelesaian/, /total penyelesaian/, /dana (yang )?dicairkan/, /^total settlement/]
const REVENUE = [/^total revenue$/, /^total pendapatan$/, /^revenue$/, /^pendapatan$/]
const FEES = [/^total fees$/, /^total biaya$/, /^biaya total$/]
const SETTLED = [/settled time/, /settlement time/, /waktu penyelesaian/, /tanggal penyelesaian/, /waktu pencairan/]
const CREATED = [/order created time/, /^created time$/, /waktu (pembuatan|pesanan) dibuat/, /waktu pesanan/]
const TYPE = [/^type$/, /^tipe$/, /^jenis$/]
const SKIP_DETAIL = [/currency|mata uang/, /time|waktu|tanggal|date/, /id$|^id |nomor|number/, /^type$|^tipe$|^jenis$/, /status/, /sku|product|produk|quantity|jumlah barang/]

const find = (header: string[], pats: RegExp[]) => {
  for (const p of pats) {
    const i = header.findIndex((h) => p.test(h))
    if (i >= 0) return i
  }
  return -1
}
const toNum = (v: Cell) => {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).replace(/[^\d.,-]/g, '')
  if (!s || s === '-') return null
  const x = parseFloat(s.includes(',') && !s.includes('.') ? s.replace(',', '.') : s.replace(/,/g, ''))
  return Number.isFinite(x) ? x : null
}

/** Mengembalikan null jika baris-baris ini bukan laporan settlement. */
export function parseSettlementRows(rows: Cell[][]): SettlementParse | null {
  const hIdx = rows.slice(0, 30).findIndex((r) => {
    const h = r.map(norm)
    return find(h, ID) >= 0 && find(h, AMOUNT) >= 0
  })
  if (hIdx < 0) return null
  const rawHeader = rows[hIdx].map((c) => String(c ?? '').trim())
  const header = rawHeader.map(norm)
  const col = {
    id: find(header, ID),
    amount: find(header, AMOUNT),
    revenue: find(header, REVENUE),
    fees: find(header, FEES),
    settled: find(header, SETTLED),
    created: find(header, CREATED),
    type: find(header, TYPE),
  }
  const used = new Set(Object.values(col).filter((i) => i >= 0))
  const body = rows.slice(hIdx + 1)
  // kolom rincian = kolom angka lain yang bukan waktu/ID
  const detailIdx = header
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) => h && !used.has(i) && !SKIP_DETAIL.some((p) => p.test(h)) && body.slice(0, 200).some((r) => toNum(r[i]) !== null && toNum(r[i]) !== 0))
    .map(({ i }) => i)

  const lines: SettlementLine[] = []
  let skipped = 0
  for (const r of body) {
    const id = String(r[col.id] ?? '').trim()
    if (!/^\d{6,}$/.test(id)) {
      if (id) skipped++
      continue
    }
    const amount = toNum(r[col.amount]) ?? 0
    const details: Record<string, number> = {}
    for (const i of detailIdx) {
      const v = toNum(r[i])
      if (v) details[rawHeader[i]] = v
    }
    const revenue = col.revenue >= 0 ? toNum(r[col.revenue]) ?? 0 : Object.values(details).filter((v) => v > 0).reduce((a, v) => a + v, 0)
    let fees: number
    if (col.fees >= 0) fees = Math.abs(toNum(r[col.fees]) ?? 0)
    else if (col.revenue >= 0) fees = Math.max(0, revenue - amount)
    else fees = -Object.values(details).filter((v) => v < 0).reduce((a, v) => a + v, 0)
    lines.push({
      ref_id: id,
      kind: col.type >= 0 ? String(r[col.type] ?? 'Order').trim() || 'Order' : 'Order',
      settled_at: col.settled >= 0 ? toIsoDateTime(r[col.settled]) : null,
      order_created_at: col.created >= 0 ? toIsoDateTime(r[col.created]) : null,
      revenue,
      fees,
      amount,
      details,
    })
  }
  const dates = lines.map((l) => l.settled_at ?? l.order_created_at).filter(Boolean).sort() as string[]
  return {
    lines,
    columns: {
      id: rawHeader[col.id],
      amount: rawHeader[col.amount],
      revenue: col.revenue >= 0 ? rawHeader[col.revenue] : null,
      fees: col.fees >= 0 ? rawHeader[col.fees] : null,
      settled: col.settled >= 0 ? rawHeader[col.settled] : null,
      details: detailIdx.map((i) => rawHeader[i]),
    },
    skipped,
    dateRange: dates.length ? [dates[0], dates[dates.length - 1]] : null,
  }
}
