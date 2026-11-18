// Barang masuk & keluar lewat scan QR. Hanya jenis yang tidak tercatat di data lain yang mengubah stok
// (lewat stock_adjustments); penjualan & retur pembeli sudah dihitung dari data penjualan, jadi hanya dicatat.
export type MoveDirection = 'masuk' | 'keluar'

export interface MoveKind {
  value: string
  label: string
  direction: MoveDirection
  /** true = membuat penyesuaian stok; false = catatan saja */
  affectsStock: boolean
  hint: string
}

export const MOVE_KINDS: MoveKind[] = [
  { value: 'penerimaan', label: 'Penerimaan batch impor', direction: 'masuk', affectsStock: false, hint: 'Barang batch tiba; selisih dengan isi batch dicatat sebagai penyesuaian' },
  { value: 'retur-pembeli', label: 'Retur dari pembeli', direction: 'masuk', affectsStock: false, hint: 'Catatan saja: stok retur sudah dihitung dari data penjualan' },
  { value: 'temuan', label: 'Temuan / koreksi masuk', direction: 'masuk', affectsStock: true, hint: 'Barang ditemukan atau salah hitung; stok bertambah' },
  { value: 'packing', label: 'Packing pesanan', direction: 'keluar', affectsStock: false, hint: 'Catatan saja: stok berkurang dari data penjualan' },
  { value: 'rusak', label: 'Rusak / cacat', direction: 'keluar', affectsStock: true, hint: 'Stok berkurang' },
  { value: 'sampel', label: 'Sampel / hadiah / endorse', direction: 'keluar', affectsStock: true, hint: 'Stok berkurang' },
  { value: 'display', label: 'Dipakai display', direction: 'keluar', affectsStock: true, hint: 'Stok jual berkurang' },
  { value: 'retur-supplier', label: 'Retur ke supplier', direction: 'keluar', affectsStock: true, hint: 'Stok berkurang' },
  { value: 'hilang', label: 'Hilang / koreksi keluar', direction: 'keluar', affectsStock: true, hint: 'Stok berkurang' },
]
export const moveKind = (v: string) => MOVE_KINDS.find((k) => k.value === v)

export interface StockMove {
  id: number
  at: string
  move_date: string
  sku: string
  qty: number
  direction: MoveDirection
  kind: string
  ref: string | null
  note: string | null
  user_name: string | null
  adjustment_id: number | null
}

/** Isi QR: tautan ke halaman SKU di portal, supaya kamera HP biasa juga bisa membukanya. */
export const qrUrl = (origin: string, sku: string) => `${origin}/qr/${encodeURIComponent(sku)}`
/** Ambil SKU dari hasil scan: tautan portal atau teks SKU langsung. */
export function skuFromScan(text: string): string | null {
  const t = text.trim()
  const m = t.match(/\/qr\/([^/?#]+)/)
  if (m) return decodeURIComponent(m[1])
  return /^[A-Za-z0-9._-]{3,40}$/.test(t) ? t : null
}
