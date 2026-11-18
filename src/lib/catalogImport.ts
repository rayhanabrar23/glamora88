// Membaca file Excel katalog (sheet Produk, Varian (SKU), Pemetaan SKU TikTok) menjadi data siap impor.
import { PRODUCT_CATEGORIES } from '../../shared/types'
import { readXlsx, readXlsxSheetNames } from './xlsx'

export interface CatalogProduct {
  code: string
  name: string
  category: string
  reference: string | null
  status: string
  notes: string | null
}
export interface CatalogVariant {
  sku: string
  product_code: string
  color: string
  price: number | null
  active: number
}
export interface CatalogMap {
  platform_sku_id: string
  sku: string
  product_name: string | null
  variation: string | null
}
export interface CatalogFile {
  products: CatalogProduct[]
  variants: CatalogVariant[]
  skuMap: CatalogMap[]
  warnings: string[]
  sheets: { products?: string; variants?: string; skuMap?: string }
}

type Cell = string | number | boolean | Date | null
const s = (v: Cell | undefined) => (v == null ? '' : String(v).trim())
const norm = (v: Cell | undefined) => s(v).toLowerCase()

/** Cari baris judul (5 baris pertama) yang memuat semua kata kunci; kembalikan indeks kolom per kunci. */
function findHeader(rows: Cell[][], keys: Record<string, (h: string) => boolean>) {
  for (let r = 0; r < Math.min(6, rows.length); r++) {
    const heads = (rows[r] ?? []).map(norm)
    const idx: Record<string, number> = {}
    for (const [k, test] of Object.entries(keys)) {
      const i = heads.findIndex(test)
      if (i >= 0) idx[k] = i
    }
    if (Object.keys(idx).length === Object.keys(keys).length) return { row: r, idx }
  }
  return null
}

const STATUS_MAP: Record<string, string> = { aktif: 'Aktif', 'uji pasar': 'Uji pasar', dihentikan: 'Dihentikan', 'tidak aktif': 'Dihentikan', nonaktif: 'Dihentikan', tidak: 'Dihentikan' }

export async function readCatalogFile(file: File): Promise<CatalogFile> {
  const names = await readXlsxSheetNames(file)
  const out: CatalogFile = { products: [], variants: [], skuMap: [], warnings: [], sheets: {} }
  for (const name of names) {
    const rows = (await readXlsx(file, name)) as Cell[][]
    // ---- Produk ----
    const hp = findHeader(rows, { code: (h) => h === 'kode model', name: (h) => h === 'nama' || h === 'nama model', cat: (h) => h.startsWith('kategori') })
    const hasSku = (rows.slice(0, 6) as Cell[][]).some((r) => r.some((c) => /sku/i.test(s(c))))
    if (hp && !hasSku && !out.sheets.products) {
      out.sheets.products = name
      const ref = (rows[hp.row] ?? []).map(norm).findIndex((h) => h.startsWith('referensi'))
      const st = (rows[hp.row] ?? []).map(norm).findIndex((h) => h === 'status')
      const nt = (rows[hp.row] ?? []).map(norm).findIndex((h) => h.startsWith('catatan'))
      for (const r of rows.slice(hp.row + 1)) {
        const code = s(r[hp.idx.code]).toUpperCase()
        if (!/^GL-\d+/i.test(code)) continue
        let category = s(r[hp.idx.cat])
        const match = PRODUCT_CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase())
        if (!match) {
          out.warnings.push(`${code}: kategori "${category || '-'}" tidak dikenal, dipakai "Tas"`)
          category = 'Tas'
        } else category = match
        const rawStatus = norm(st >= 0 ? r[st] : 'Aktif')
        out.products.push({
          code,
          name: s(r[hp.idx.name]),
          category,
          reference: ref >= 0 ? s(r[ref]) || null : null,
          status: STATUS_MAP[rawStatus] ?? 'Aktif',
          notes: nt >= 0 ? s(r[nt]) || null : null,
        })
      }
      continue
    }
    // ---- Pemetaan SKU TikTok ----
    const hm = findHeader(rows, { id: (h) => h.includes('sku id'), sku: (h) => h.includes('sku portal') })
    if (hm && !out.sheets.skuMap) {
      out.sheets.skuMap = name
      const heads = (rows[hm.row] ?? []).map(norm)
      const pn = heads.findIndex((h) => h.startsWith('nama produk'))
      const va = heads.findIndex((h) => h.startsWith('variasi'))
      for (const r of rows.slice(hm.row + 1)) {
        const rawId = r[hm.idx.id]
        const sku = s(r[hm.idx.sku]).toUpperCase()
        if (rawId == null || !sku) continue
        const id = typeof rawId === 'number' ? (Number.isSafeInteger(rawId) ? String(rawId) : '') : s(rawId)
        if (!/^\d+$/.test(id)) {
          out.warnings.push(`Pemetaan ${sku}: SKU ID TikTok "${s(rawId)}" tidak terbaca utuh (simpan kolom ini sebagai teks), dilewati`)
          continue
        }
        out.skuMap.push({ platform_sku_id: id, sku, product_name: pn >= 0 ? s(r[pn]) || null : null, variation: va >= 0 ? s(r[va]) || null : null })
      }
      continue
    }
    // ---- Varian ----
    const hv = findHeader(rows, { sku: (h) => h === 'sku' || h === 'seller sku' || h === 'kode sku', model: (h) => h === 'kode model', color: (h) => h.startsWith('warna') })
    if (hv && !out.sheets.variants) {
      out.sheets.variants = name
      const heads = (rows[hv.row] ?? []).map(norm)
      const pr = heads.findIndex((h) => h.startsWith('harga'))
      const ac = heads.findIndex((h) => h === 'aktif' || h === 'status')
      for (const r of rows.slice(hv.row + 1)) {
        const sku = s(r[hv.idx.sku]).toUpperCase()
        if (!/^GL-\d+/i.test(sku)) continue
        const rawPrice = pr >= 0 ? r[pr] : null
        let price: number | null = null
        if (typeof rawPrice === 'number') price = rawPrice
        else if (s(rawPrice)) {
          const n = Number(s(rawPrice).replace(/[^\d]/g, ''))
          if (n > 0) price = n
          else out.warnings.push(`${sku}: harga "${s(rawPrice)}" bukan angka, dikosongkan`)
        }
        const act = norm(ac >= 0 ? r[ac] : 'ya')
        out.variants.push({ sku, product_code: s(r[hv.idx.model]).toUpperCase(), color: s(r[hv.idx.color]), price, active: /^(tidak|no|0|nonaktif|dihentikan)/.test(act) ? 0 : 1 })
      }
    }
  }
  return out
}
