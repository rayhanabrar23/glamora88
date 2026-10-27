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
  td,
  tdNum,
  th,
  Textarea,
  useToast,
} from '../components/ui'
import { Icon } from '../components/Icon'

export default function Products() {
  const refs = useRefs()
  const stock = useData<StockRow[]>('/stock')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [prodForm, setProdForm] = useState<Partial<Product> | null>(null)
  const [varForm, setVarForm] = useState<Partial<Variant> | null>(null)
  const [opname, setOpname] = useState(false)
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
      <Card padded={false}>
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
            const trackedP = p.category !== 'Kemasan'
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
      </Card>
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
        <Field label="Kode model" hint="Contoh: GL-14">
          <Input value={v.code ?? ''} disabled={editing} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} />
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
        <Field label="Kode SKU" hint="Contoh: GL-01COCT08">
          <Input value={v.sku ?? ''} disabled={editing} onChange={(e) => setV({ ...v, sku: e.target.value.toUpperCase() })} />
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
