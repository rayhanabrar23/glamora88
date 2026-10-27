import type { Product, Store, Variant } from '../../shared/types'
import { useData } from './useData'

/** Data referensi yang dipakai banyak halaman: toko, produk, varian. */
export function useRefs() {
  const p = useData<{ products: Product[]; variants: Variant[] }>('/products')
  const s = useData<{ settings: Record<string, string>; stores: Store[] }>('/settings')
  const products = p.data?.products ?? []
  const variants = p.data?.variants ?? []
  const productName = new Map(products.map((x) => [x.code, x.name]))
  const variantLabel = (sku: string | null | undefined) => {
    if (!sku) return 'Belum dipetakan'
    const v = variants.find((x) => x.sku === sku)
    return v ? `${productName.get(v.product_code) ?? v.product_code} · ${v.color}` : sku
  }
  const skuOptions = variants.map((v) => ({ value: v.sku, label: `${v.sku} — ${productName.get(v.product_code) ?? ''} ${v.color}` }))
  return {
    loading: !p.data || !s.data,
    products,
    variants,
    stores: (s.data?.stores ?? []).map((x) => x.name),
    settings: s.data?.settings ?? {},
    variantLabel,
    skuOptions,
    reload: () => {
      p.reload()
      s.reload()
    },
  }
}
