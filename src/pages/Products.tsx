import { Fragment, useMemo, useState } from 'react'
import type { StockRow } from '../../shared/metrics'
import { PRODUCT_CATEGORIES, type Product, type Variant } from '../../shared/types'
import { api } from '../lib/api'
import { dateLabel, int, pct, rp, today } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import {
  Badge,
  Button,
  Callout,
  Card,
  confirmDelete,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Loading,
  Modal,
  PageHeader,
  Select,
  Stat,
  Table,
  Tabs,
  td,
  tdNum,
  th,
  Textarea,
  useToast,
} from '../components/ui'
import { Icon } from '../components/Icon'
import RestockPlan from './RestockPlan'
import { readCatalogFile, type CatalogFile } from '../lib/catalogImport'

export default function Products() {
  const refs = useRefs()
  const stock = useData<StockRow[]>('/stock')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [prodForm, setProdForm] = useState<Partial<Product> | null>(null)
  const [varForm, setVarForm] = useState<Partial<Variant> | null>(null)
  const [opname, setOpname] = useState(false)
  const [importing, setImporting] = useState(false)
  const [view, setView] = useState<'stok' | 'harga' | 'restock'>('stok')
  const [priceFor, setPriceFor] = useState<{ title: string; skus: string[] } | null>(null)
  const toast = useToast()

  const byProduct = useMemo(() => {
    const m = new Map<string, StockRow[]>()
    for (const r of stock.data ?? []) {
      const arr = m.get(r.product_code) ?? []
      arr.push(r)
      m.set(r.product_code, arr)
    }
    return m
  }, [stock.data])

  if (stock.error) return <ErrorBox message={stock.error} onRetry={stock.reload} />
  if (!stock.data || refs.loading) return <Loading />
  const tracked = stock.data.filter((r) => r.tracked)
  const units = tracked.reduce((a, r) => a + Math.max(0, r.onHand), 0)
  const value = tracked.reduce((a, r) => a + r.value, 0)
  const transit = tracked.reduce((a, r) => a + r.inTransit, 0)
  const negatives = tracked.filter((r) => r.onHand < 0)

  async function removeProduct(p: Product) {
    if (!confirmDelete(`produk ${p.code} beserta semua variannya`)) return
    await api.del(`/products/${encodeURIComponent(p.code)}`)
    toast('Produk dihapus')
    refs.reload()
    stock.reload()
  }
  async function removeVariant(sku: string) {
    if (!confirmDelete(`varian ${sku}`)) return
    await api.del(`/variants/${encodeURIComponent(sku)}`)
    toast('Varian dihapus')
    refs.reload()
    stock.reload()
  }

  return (
    <>
      <PageHeader
        title="Produk & Stok"
        actions={
          <>
            <Button icon="upload" onClick={() => setImporting(true)}>
              Impor dari Excel
            </Button>
            <Button icon="stock" onClick={() => setOpname(true)}>
              Stock opname
            </Button>
            <Button variant="primary" icon="plus" onClick={() => setProdForm({ category: 'Tas', status: 'Aktif' })}>
              Produk baru
            </Button>
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Stok di gudang" value={`${int(units)} pcs`} />
        <Stat label="Nilai stok (landed cost)" value={rp(value, { compact: true })} />
        <Stat label="Dalam perjalanan" value={`${int(transit)} pcs`} />
        <Stat label="Model aktif" value={int(refs.products.filter((p) => p.status === 'Aktif').length)} hint={`${int(refs.variants.length)} varian`} />
      </div>
      {negatives.length > 0 && (
        <div className="mb-4">
          <Callout tone="warning" title={`${negatives.length} SKU stoknya minus`}>
            {negatives.map((r) => r.sku).join(', ')}
          </Callout>
        </div>
      )}
      <div className="mb-3">
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: 'stok', label: 'Stok' },
            { value: 'harga', label: 'Daftar harga' },
            { value: 'restock', label: 'Rencana restock' },
          ]}
        />
      </div>
      {view === 'restock' && <RestockPlan />}
      {view === 'harga' && <PriceList products={refs.products} byProduct={byProduct} open={open} setOpen={setOpen} onEdit={(title, skus) => setPriceFor({ title, skus })} />}
      {view === 'stok' && <Card padded={false}>
        <Table
          head={
            <tr>
              <th className={th}>Model</th>
              <th className={`${th} text-right`}>Dibeli (tiba)</th>
              <th className={`${th} text-right`}>Terjual neto</th>
              <th className={`${th} text-right`}>Sisa</th>
              <th className={`${th} text-right`}>% terjual</th>
              <th className={`${th} text-right`}>Nilai stok</th>
              <th className={th}>Terakhir laku</th>
              <th className={th}></th>
            </tr>
          }
        >
          {refs.products.map((p) => {
            const rows = byProduct.get(p.code) ?? []
            const sum = (k: keyof StockRow) => rows.reduce((a, r) => a + (Number(r[k]) || 0), 0)
            const arrived = sum('arrived')
            const sold = sum('soldNet')
            const last = rows.map((r) => r.lastSale).filter(Boolean).sort().pop() ?? null
            const isOpen = open[p.code]
            const trackedP = rows.some((r) => r.tracked)
            return (
              <Fragment key={p.code}>
                <tr className="cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [p.code]: !o[p.code] }))}>
                  <td className={td}>
                    <div className="flex items-center gap-2">
                      <Icon name="chevron" size={16} className={`text-muted transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                      <div>
                        <div className="font-medium text-ink">
                          {p.code} · {p.name}
                        </div>
                        <div className="text-[12px] text-muted">
                          {p.category} · {rows.length} varian{p.reference ? ` · ${p.reference}` : ''}
                        </div>
                      </div>
                      {p.status !== 'Aktif' && <Badge>{p.status}</Badge>}
                    </div>
                  </td>
                  <td className={tdNum}>{trackedP ? int(arrived) : '–'}</td>
                  <td className={tdNum}>{int(sold)}</td>
                  <td className={`${tdNum} font-semibold`}>{trackedP ? int(sum('onHand')) : '–'}</td>
                  <td className={tdNum}>{trackedP && arrived ? pct(sold / arrived, 0) : '–'}</td>
                  <td className={tdNum}>{trackedP ? rp(sum('value'), { compact: true }) : '–'}</td>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>{last ? dateLabel(last.slice(0, 10)) : <Badge tone="warn">Belum pernah</Badge>}</td>
                  <td className={`${td} whitespace-nowrap text-right`} onClick={(e) => e.stopPropagation()}>
                    <IconButton icon="plus" label="Tambah varian" onClick={() => setVarForm({ product_code: p.code, active: 1 })} />
                    <IconButton icon="edit" label="Ubah produk" onClick={() => setProdForm(p)} />
                    <IconButton icon="trash" label="Hapus produk" tone="danger" onClick={() => removeProduct(p)} />
                  </td>
                </tr>
                {isOpen &&
                  rows.map((r) => (
                    <tr key={r.sku} className="bg-canvas/40 text-[13.5px]">
                      <td className={`${td} pl-12`}>
                        <span className="text-ink">{r.color || r.sku}</span>
                        <span className="text-muted"> · {r.sku} · {rp(r.landed, { compact: true })}/pcs</span>
                      </td>
                      <td className={tdNum}>
                        {r.tracked ? int(r.arrived) : '–'}
                        {r.inTransit > 0 && <span className="text-info"> +{r.inTransit}</span>}
                      </td>
                      <td className={tdNum}>{int(r.soldNet)}</td>
                      <td className={`${tdNum} font-medium ${r.onHand < 0 ? 'text-bad' : ''}`}>{r.tracked ? int(r.onHand) : '–'}</td>
                      <td className={tdNum}>{r.sellThrough != null ? pct(r.sellThrough, 0) : '–'}</td>
                      <td className={tdNum}>{r.tracked ? rp(r.value, { compact: true }) : '–'}</td>
                      <td className={`${td} text-ink-2`}>{r.lastSale ? dateLabel(r.lastSale.slice(0, 10)) : '–'}</td>
                      <td className={`${td} text-right`}>
                        <IconButton
                          icon="edit"
                          label="Ubah varian"
                          onClick={() => {
                            const v = refs.variants.find((x) => x.sku === r.sku)
                            if (v) setVarForm(v)
                          }}
                        />
                        <IconButton icon="trash" label="Hapus varian" tone="danger" onClick={() => removeVariant(r.sku)} />
                      </td>
                    </tr>
                  ))}
              </Fragment>
            )
          })}
        </Table>
      </Card>}
      {priceFor && (
        <PriceForm
          title={priceFor.title}
          variants={refs.variants.filter((v) => priceFor.skus.includes(v.sku))}
          suggested={sellOf((stock.data ?? []).filter((r) => priceFor.skus.includes(r.sku))).value}
          onClose={() => setPriceFor(null)}
          onSaved={() => {
            refs.reload()
            stock.reload()
          }}
        />
      )}
      {prodForm && (
        <ProductForm
          initial={prodForm}
          onClose={() => setProdForm(null)}
          onSaved={() => {
            refs.reload()
            stock.reload()
          }}
        />
      )}
      {varForm && (
        <VariantForm
          initial={varForm}
          products={refs.products}
          onClose={() => setVarForm(null)}
          onSaved={() => {
            refs.reload()
            stock.reload()
          }}
        />
      )}
      {opname && <OpnameForm rows={tracked} label={refs.variantLabel} onClose={() => setOpname(false)} onSaved={stock.reload} />}
      {importing && (
        <CatalogImport
          products={refs.products}
          variants={refs.variants}
          onClose={() => setImporting(false)}
          onSaved={() => {
            refs.reload()
            stock.reload()
            window.dispatchEvent(new Event('g88:refresh'))
          }}
        />
      )}
    </>
  )
}

function ProductForm({ initial, onClose, onSaved }: { initial: Partial<Product>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial)
  const editing = !!initial.code && !!initial.name
  const toast = useToast()
  async function save() {
    try {
      await api.post('/products', v)
      toast('Produk disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <Modal
      open
      title={editing ? `Ubah ${initial.code}` : 'Produk baru'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!v.code || !v.name}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Kode model">
          <Input value={v.code ?? ''} disabled={editing} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="GL-14" />
        </Field>
        <Field label="Kategori">
          <Select value={v.category ?? 'Tas'} onChange={(e) => setV({ ...v, category: e.target.value })} options={[...PRODUCT_CATEGORIES]} />
        </Field>
        <Field label="Nama model" className="col-span-2">
          <Input value={v.name ?? ''} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder="Contoh: Tas Bahu Mini" />
        </Field>
        <Field label="Referensi / model acuan">
          <Input value={v.reference ?? ''} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </Field>
        <Field label="Status">
          <Select value={v.status ?? 'Aktif'} onChange={(e) => setV({ ...v, status: e.target.value })} options={['Aktif', 'Uji pasar', 'Dihentikan']} />
        </Field>
        <Field label="Catatan" className="col-span-2">
          <Textarea value={v.notes ?? ''} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  )
}

function VariantForm({ initial, products, onClose, onSaved }: { initial: Partial<Variant>; products: Product[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial)
  const editing = !!initial.sku
  const toast = useToast()
  async function save() {
    try {
      await api.post('/variants', v)
      toast('Varian disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <Modal
      open
      title={editing ? `Ubah varian ${initial.sku}` : 'Varian baru'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!v.sku || !v.color || !v.product_code}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Model">
          <Select
            value={v.product_code ?? ''}
            onChange={(e) => setV({ ...v, product_code: e.target.value })}
            options={products.map((p) => ({ value: p.code, label: `${p.code} · ${p.name}` }))}
          />
        </Field>
        <Field label="Kode SKU">
          <Input value={v.sku ?? ''} disabled={editing} onChange={(e) => setV({ ...v, sku: e.target.value.toUpperCase() })} placeholder="GL-01COCT08" />
        </Field>
        <Field label="Warna / varian">
          <Input value={v.color ?? ''} onChange={(e) => setV({ ...v, color: e.target.value })} />
        </Field>
        <Field label="Harga jual (Rp)">
          <Input type="number" value={v.price ?? ''} onChange={(e) => setV({ ...v, price: e.target.value === '' ? null : Number(e.target.value) })} />
        </Field>
      </div>
    </Modal>
  )
}

function OpnameForm({ rows, label, onClose, onSaved }: { rows: StockRow[]; label: (s: string) => string; onClose: () => void; onSaved: () => void }) {
  const [date, setDate] = useState(today())
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const changed = Object.entries(counts).filter(([sku, v]) => v !== '' && Number(v) !== rows.find((r) => r.sku === sku)?.onHand)
  async function save() {
    setBusy(true)
    try {
      const r = await api.post<{ adjusted: number }>('/stock/opname', {
        date,
        reason: 'Stock opname',
        counts: Object.entries(counts)
          .filter(([, v]) => v !== '')
          .map(([sku, v]) => ({ sku, counted: Number(v) })),
      })
      toast(`${r.adjusted} SKU disesuaikan`)
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      wide
      title="Stock opname"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={busy || !changed.length}>
            Simpan {changed.length ? `(${changed.length} selisih)` : ''}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <Field label="Tanggal hitung">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
      </div>
      <div className="max-h-[55vh] overflow-y-auto rounded-xl border border-line">
        <Table
          head={
            <tr>
              <th className={th}>SKU</th>
              <th className={`${th} text-right`}>Menurut sistem</th>
              <th className={`${th} w-[130px] text-right`}>Hasil hitung</th>
              <th className={`${th} text-right`}>Selisih</th>
            </tr>
          }
        >
          {rows.map((r) => {
            const c = counts[r.sku] ?? ''
            const diff = c === '' ? null : Number(c) - r.onHand
            return (
              <tr key={r.sku}>
                <td className={td}>
                  <div className="text-ink">{label(r.sku)}</div>
                  <div className="text-[12px] text-muted">{r.sku}</div>
                </td>
                <td className={tdNum}>{int(r.onHand)}</td>
                <td className={tdNum}>
                  <Input type="number" min={0} className="h-9 text-right" value={c} onChange={(e) => setCounts({ ...counts, [r.sku]: e.target.value })} />
                </td>
                <td className={`${tdNum} ${diff == null ? '' : diff < 0 ? 'text-bad' : diff > 0 ? 'text-good' : ''}`}>{diff == null ? '' : diff > 0 ? `+${diff}` : diff}</td>
              </tr>
            )
          })}
        </Table>
      </div>
    </Modal>
  )
}

// ---------- Daftar harga ----------
const wavg = (rows: StockRow[], val: (r: StockRow) => number | null, w: (r: StockRow) => number) => {
  const ok = rows.filter((r) => val(r) != null)
  if (!ok.length) return null
  const tw = ok.reduce((a, r) => a + Math.max(0, w(r)), 0)
  return tw > 0 ? ok.reduce((a, r) => a + val(r)! * Math.max(0, w(r)), 0) / tw : ok.reduce((a, r) => a + val(r)!, 0) / ok.length
}
/** harga jual: harga katalog bila semua varian sudah diisi, selain itu rata-rata penjualan aktual */
function sellOf(rows: StockRow[]): { value: number | null; source: 'katalog' | 'rata-rata terjual' | null } {
  if (rows.length && rows.every((r) => r.listPrice != null)) return { value: wavg(rows, (r) => r.listPrice, () => 1), source: 'katalog' }
  const avg = wavg(rows, (r) => r.avgSell, (r) => r.soldNet)
  return { value: avg, source: avg != null ? 'rata-rata terjual' : null }
}
const cny = (v: number) => `¥${v.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`
function span(rows: StockRow[], val: (r: StockRow) => number | null, fmt: (v: number) => string) {
  const xs = rows.map(val).filter((v): v is number => v != null)
  if (!xs.length) return '–'
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return hi - lo < 0.005 * Math.max(1, hi) ? fmt(hi) : `${fmt(lo)} – ${fmt(hi)}`
}

function PriceList({ products, byProduct, open, setOpen, onEdit }: {
  products: Product[]
  byProduct: Map<string, StockRow[]>
  open: Record<string, boolean>
  setOpen: (f: (o: Record<string, boolean>) => Record<string, boolean>) => void
  onEdit: (title: string, skus: string[]) => void
}) {
  const cells = (landed: number | null, sell: { value: number | null; source: string | null }, sellText?: string) => {
    const margin = landed != null && sell.value != null ? sell.value - landed : null
    return (
      <>
        <td className={tdNum}>{landed != null ? rp(landed) : '–'}</td>
        <td className={tdNum}>
          {sellText ?? (sell.value != null ? rp(sell.value) : '–')}
          {sell.source && <div className="text-[11.5px] font-normal text-muted">{sell.source}</div>}
        </td>
        <td className={`${tdNum} ${margin != null && margin < 0 ? 'text-bad' : ''}`}>{margin != null ? rp(margin) : '–'}</td>
        <td className={tdNum}>{margin != null && sell.value ? pct(margin / sell.value, 0) : '–'}</td>
      </>
    )
  }
  return (
    <Card padded={false}>
      <Table
        head={
          <tr>
            <th className={th}>Produk</th>
            <th className={`${th} text-right`}>Harga beli (¥)</th>
            <th className={`${th} text-right`}>Harga beli (Rp)</th>
            <th className={`${th} text-right`}>Modal sampai gudang</th>
            <th className={`${th} text-right`}>Harga jual</th>
            <th className={`${th} text-right`}>Margin / pcs</th>
            <th className={`${th} text-right`}>Margin</th>
            <th className={th}></th>
          </tr>
        }
      >
        {products.map((p) => {
          const rows = byProduct.get(p.code) ?? []
          const isOpen = open[p.code]
          return (
            <Fragment key={p.code}>
              <tr className="cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [p.code]: !o[p.code] }))}>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <Icon name="chevron" size={16} className={`text-muted transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                    <div>
                      <div className="font-medium text-ink">
                        {p.code} · {p.name}
                      </div>
                      <div className="text-[12px] text-muted">
                        {p.category} · {rows.length} varian
                      </div>
                    </div>
                  </div>
                </td>
                <td className={tdNum}>{span(rows, (r) => r.buyCny, cny)}</td>
                <td className={tdNum}>{span(rows, (r) => r.buyRp, (v) => rp(v))}</td>
                {cells(wavg(rows, (r) => r.landed, (r) => r.arrived), sellOf(rows), rows.length && rows.every((r) => r.listPrice != null) ? span(rows, (r) => r.listPrice, (v) => rp(v)) : undefined)}
                <td className={`${td} text-right`} onClick={(e) => e.stopPropagation()}>
                  <IconButton icon="edit" label="Atur harga jual semua warna" onClick={() => onEdit(`${p.code} · ${p.name} (semua warna)`, rows.map((r) => r.sku))} />
                </td>
              </tr>
              {isOpen &&
                rows.map((r) => (
                  <tr key={r.sku} className="bg-canvas/40 text-[13.5px]">
                    <td className={`${td} pl-12`}>
                      <span className="text-ink">{r.color || r.sku}</span>
                      <span className="text-muted"> · {r.sku}</span>
                    </td>
                    <td className={tdNum}>{r.buyCny != null ? cny(r.buyCny) : '–'}</td>
                    <td className={tdNum}>{r.buyRp != null ? rp(r.buyRp) : '–'}</td>
                    {cells(r.landed, sellOf([r]))}
                    <td className={`${td} text-right`}>
                      <IconButton icon="edit" label={`Atur harga jual ${r.color || r.sku}`} onClick={() => onEdit(`${p.name} · ${r.color || r.sku}`, [r.sku])} />
                    </td>
                  </tr>
                ))}
            </Fragment>
          )
        })}
      </Table>
    </Card>
  )
}

function PriceForm({ title, variants, suggested, onClose, onSaved }: { title: string; variants: Variant[]; suggested: number | null; onClose: () => void; onSaved: () => void }) {
  const same = variants.length > 0 && variants.every((v) => v.price === variants[0].price) ? variants[0].price : null
  const [price, setPrice] = useState<number | ''>(same ?? (suggested != null ? Math.round(suggested) : ''))
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  async function save() {
    setBusy(true)
    try {
      for (const v of variants) await api.post('/variants', { ...v, price: price === '' ? null : price })
      toast('Harga jual disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      title={`Harga jual ${title}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={busy || !variants.length}>
            Simpan
          </Button>
        </>
      }
    >
      <Field label="Harga jual katalog (Rp)" hint={variants.length > 1 ? `Berlaku untuk ${variants.length} warna sekaligus. Untuk harga yang berbeda per warna, buka produknya lalu klik pensil di baris warna. Kosongkan untuk memakai rata-rata penjualan.` : 'Hanya untuk warna ini. Kosongkan untuk memakai rata-rata penjualan.'}>
        <Input type="number" min={0} autoFocus value={price} onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))} />
      </Field>
    </Modal>
  )
}

// ---------- Impor katalog dari Excel ----------
function CatalogImport({ products, variants, onClose, onSaved }: { products: Product[]; variants: Variant[]; onClose: () => void; onSaved: () => void }) {
  const [file, setFile] = useState<CatalogFile | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [withMap, setWithMap] = useState(true)
  const toast = useToast()
  async function pick(f: File) {
    setErr('')
    setFile(null)
    setName(f.name)
    try {
      const c = await readCatalogFile(f)
      if (!c.products.length && !c.variants.length && !c.skuMap.length) throw new Error('Tidak ada sheet Produk, Varian (SKU), atau Pemetaan SKU TikTok yang dikenali di file ini.')
      setFile(c)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const prodCodes = new Set([...products.map((p) => p.code), ...(file?.products ?? []).map((p) => p.code)])
  const skuSet = new Set([...variants.map((v) => v.sku), ...(file?.variants ?? []).map((v) => v.sku)])
  const orphanVariants = (file?.variants ?? []).filter((v) => !prodCodes.has(v.product_code))
  const orphanMaps = (file?.skuMap ?? []).filter((m) => !skuSet.has(m.sku))
  const count = <T,>(rows: T[], key: (r: T) => string, existing: Set<string>) => {
    const fresh = rows.filter((r) => !existing.has(key(r))).length
    return { fresh, update: rows.length - fresh }
  }
  const pc = file ? count(file.products, (p) => p.code, new Set(products.map((p) => p.code))) : null
  const vc = file ? count(file.variants, (v) => v.sku, new Set(variants.map((v) => v.sku))) : null
  const blocked = orphanVariants.length > 0 || (withMap && orphanMaps.length > 0)
  async function save() {
    if (!file) return
    setBusy(true)
    try {
      const r = await api.post<{ products: number; variants: number; skuMap: number }>('/catalog/import', {
        products: file.products,
        variants: file.variants,
        skuMap: withMap ? file.skuMap : [],
      })
      toast(`Impor selesai: ${r.products} model, ${r.variants} varian, ${r.skuMap} pemetaan`)
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      wide
      title="Impor produk & varian dari Excel"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!file || busy || blocked}>
            {busy ? 'Mengimpor…' : 'Impor'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-full border border-line bg-white px-4 py-2 text-[14px] font-medium text-ink hover:border-gold">
          <Icon name="upload" size={16} /> {name || 'Pilih file .xlsx'}
          <input type="file" accept=".xlsx" className="hidden" onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
        </label>
        {err && <Callout tone="critical" title="File tidak bisa dibaca">{err}</Callout>}
        {file && pc && vc && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ['Model', file.products.length, `${pc.fresh} baru · ${pc.update} diperbarui`, file.sheets.products],
                ['Varian (SKU)', file.variants.length, `${vc.fresh} baru · ${vc.update} diperbarui`, file.sheets.variants],
                ['Pemetaan SKU TikTok', file.skuMap.length, withMap ? 'ikut diimpor' : 'tidak diimpor', file.sheets.skuMap],
              ].map(([k, n, sub, sheet]) => (
                <div key={String(k)} className="rounded-xl border border-line-soft bg-canvas/60 px-4 py-3">
                  <div className="text-[12.5px] text-muted">{k}</div>
                  <div className="num text-[22px] font-semibold text-ink">{int(Number(n))}</div>
                  <div className="text-[12px] text-ink-2">{sub}</div>
                  <div className="text-[11.5px] text-muted">{sheet ? `sheet "${sheet}"` : 'sheet tidak ditemukan'}</div>
                </div>
              ))}
            </div>
            {file.skuMap.length > 0 && (
              <label className="flex items-center gap-2 text-[13.5px] text-ink-2">
                <input type="checkbox" className="accent-[#1f2a44]" checked={withMap} onChange={(e) => setWithMap(e.target.checked)} />
                Impor juga pemetaan SKU TikTok (penjualan yang sudah ada ikut dipetakan ulang)
              </label>
            )}
            {orphanVariants.length > 0 && (
              <Callout tone="critical" title={`${orphanVariants.length} varian belum punya model`}>
                {orphanVariants.slice(0, 6).map((v) => `${v.sku} (model ${v.product_code || '-'})`).join(', ')}. Tambahkan modelnya di sheet Produk, lalu pilih file lagi.
              </Callout>
            )}
            {withMap && orphanMaps.length > 0 && (
              <Callout tone="critical" title={`${orphanMaps.length} pemetaan memakai SKU yang tidak ada`}>
                {[...new Set(orphanMaps.map((m) => m.sku))].slice(0, 6).join(', ')}. Betulkan SKU-nya di file, atau hilangkan centang impor pemetaan.
              </Callout>
            )}
            {file.warnings.length > 0 && (
              <Callout tone="warning" title={`${file.warnings.length} catatan`}>
                <ul className="list-disc pl-5">
                  {file.warnings.slice(0, 8).map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </Callout>
            )}
            <div className="max-h-[260px] overflow-y-auto rounded-xl border border-line-soft">
              <Table
                head={
                  <tr>
                    <th className={th}>SKU</th>
                    <th className={th}>Model</th>
                    <th className={th}>Warna</th>
                    <th className={`${th} text-right`}>Harga</th>
                    <th className={th}>Aktif</th>
                  </tr>
                }
              >
                {file.variants.map((v) => (
                  <tr key={v.sku}>
                    <td className={`${td} whitespace-nowrap font-medium text-ink`}>{v.sku}</td>
                    <td className={td}>{v.product_code}</td>
                    <td className={td}>{v.color}</td>
                    <td className={tdNum}>{v.price ? rp(v.price) : '–'}</td>
                    <td className={td}>{v.active ? 'Ya' : 'Tidak'}</td>
                  </tr>
                ))}
              </Table>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
