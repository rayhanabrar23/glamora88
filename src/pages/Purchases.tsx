import { Fragment, useState } from 'react'
import { PURCHASE_STATUSES, type Purchase, type PurchaseItem } from '../../shared/types'
import { api } from '../lib/api'
import { dateLabel, int, rp, today } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import { Icon } from '../components/Icon'
import {
  Badge,
  Button,
  Card,
  confirmDelete,
  Empty,
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

type Form = Partial<Purchase> & { items: { sku: string; qty: number | ''; price_cny: number | '' | null }[] }

const statusTone = { Dipesan: 'warn', 'Dalam perjalanan': 'info', Tiba: 'good' } as const

function costOf(p: Purchase | Form, items: { qty: number | ''; price_cny: number | '' | null }[], fallback: number) {
  const q = items.reduce((a, i) => a + (Number(i.qty) || 0), 0)
  const overhead = (Number(p.cargo_cost) || 0) + (Number(p.other_cost) || 0)
  const perPcsOverhead = q ? overhead / q : 0
  // sama dengan perhitungan server: SKU tanpa harga beli dinilai landed cost cadangan (sudah termasuk cargo)
  const goods = items.reduce(
    (a, i) =>
      a + (Number(i.qty) || 0) * (i.price_cny === '' || i.price_cny == null ? fallback - perPcsOverhead : Number(i.price_cny) * (Number(p.exchange_rate) || 0)),
    0,
  )
  const unknown = items.some((i) => i.price_cny === '' || i.price_cny == null)
  return { qty: q, goods, overhead, total: goods + overhead, perPcs: q ? (goods + overhead) / q : 0, unknown }
}

export default function Purchases() {
  const { data, error, reload } = useData<{ purchases: Purchase[]; items: PurchaseItem[] }>('/purchases')
  const refs = useRefs()
  const [form, setForm] = useState<Form | null>(null)
  const toast = useToast()
  const fallback = Number(refs.settings.fallback_landed_cost || 120000)
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />
  const itemsOf = (id: number) => data.items.filter((i) => i.purchase_id === id)
  const all = data.purchases.map((p) => ({ p, c: costOf(p, itemsOf(p.id), fallback) }))
  const inTransit = all.filter((x) => x.p.status !== 'Tiba')
  async function remove(p: Purchase) {
    if (!confirmDelete(p.name)) return
    await api.del(`/purchases/${p.id}`)
    toast('Pembelian dihapus')
    reload()
  }
  return (
    <>
      <PageHeader
        title="Pembelian & Impor"
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() =>
              setForm({ name: `Batch ${data.purchases.length + 1}`, order_date: today(), status: 'Dipesan', exchange_rate: 3000, cargo_cost: 0, other_cost: 0, items: [{ sku: '', qty: '', price_cny: '' }] })
            }
          >
            Batch baru
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Jumlah batch" value={int(all.length)} />
        <Stat label="Total pcs dibeli" value={`${int(all.reduce((a, x) => a + x.c.qty, 0))} pcs`} />
        <Stat label="Total nilai pembelian" value={rp(all.reduce((a, x) => a + x.c.total, 0), { compact: true })} />
        <Stat
          label="Belum tiba"
          value={`${int(inTransit.reduce((a, x) => a + x.c.qty, 0))} pcs`}
          hint={inTransit.length ? `${inTransit.length} batch · ${rp(inTransit.reduce((a, x) => a + x.c.total, 0), { compact: true })}` : 'Semua batch sudah tiba'}
        />
      </div>
      {!all.length ? (
        <Empty title="Belum ada pembelian" />
      ) : (
        <div className="flex flex-col gap-4">
          {all.map(({ p, c }) => (
            <Card
              key={p.id}
              title={
                <span className="flex items-center gap-3">
                  {p.name} <Badge tone={statusTone[p.status as keyof typeof statusTone] ?? 'neutral'}>{p.status}</Badge>
                </span>
              }
              subtitle={`Dibayar ${dateLabel(p.order_date)}${p.arrival_date ? ` · tiba ${dateLabel(p.arrival_date)}` : ''}${p.supplier ? ` · ${p.supplier}` : ''}`}
              actions={
                <div className="flex">
                  <IconButton
                    icon="edit"
                    label="Ubah"
                    onClick={() => setForm({ ...p, items: itemsOf(p.id).map((i) => ({ sku: i.sku, qty: i.qty, price_cny: i.price_cny })) })}
                  />
                  <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => remove(p)} />
                </div>
              }
            >
              <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[
                  ['Isi batch', `${int(c.qty)} pcs`],
                  ['Total biaya', rp(c.total)],
                  ['Landed cost rata-rata', `${rp(c.perPcs)} / pcs`],
                  ['Kurs · cargo + lain', `Rp${int(p.exchange_rate)} · ${rp(c.overhead, { compact: true })}`],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-2xl bg-canvas/70 px-4 py-3">
                    <dt className="text-[12.5px] text-muted">{k}</dt>
                    <dd className="num mt-0.5 text-[15px] font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <BatchItems p={p} items={itemsOf(p.id)} overheadPerPcs={c.qty ? c.overhead / c.qty : 0} fallback={fallback} refs={refs} />
              {p.notes && <p className="mt-3 rounded-2xl bg-canvas/70 px-4 py-3 text-[13px] leading-relaxed text-ink-2">{p.notes}</p>}
            </Card>
          ))}
        </div>
      )}
      {form && <PurchaseForm initial={form} refs={refs} fallback={fallback} onClose={() => setForm(null)} onSaved={reload} />}
    </>
  )
}

function BatchItems({ p, items, overheadPerPcs, fallback, refs }: { p: Purchase; items: PurchaseItem[]; overheadPerPcs: number; fallback: number; refs: ReturnType<typeof useRefs> }) {
  const [open, setOpen] = useState(true)
  const variantOf = new Map(refs.variants.map((v) => [v.sku, v]))
  const nameOf = new Map(refs.products.map((x) => [x.code, x.name]))
  const rate = Number(p.exchange_rate) || 0
  // landed cost per pcs = harga beli × kurs + (cargo + biaya lain) dibagi rata; tanpa harga beli memakai nilai cadangan
  const landed = (i: PurchaseItem) => (i.price_cny == null ? fallback : i.price_cny * rate + overheadPerPcs)
  const groups = new Map<string, PurchaseItem[]>()
  for (const i of [...items].sort((a, b) => a.sku.localeCompare(b.sku))) {
    const code = variantOf.get(i.sku)?.product_code ?? '—'
    groups.set(code, [...(groups.get(code) ?? []), i])
  }
  const qty = (rows: PurchaseItem[]) => rows.reduce((a, i) => a + i.qty, 0)
  const total = (rows: PurchaseItem[]) => rows.reduce((a, i) => a + i.qty * landed(i), 0)
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-line-soft">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 bg-canvas/70 px-4 py-2.5 text-left text-[13.5px] font-semibold text-ink hover:bg-gold-soft/50">
        <span>
          Rincian per SKU <span className="num font-normal text-muted">· {groups.size} model · {items.length} SKU</span>
        </span>
        <Icon name="chevron" size={16} className={`text-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <Table
          head={
            <tr>
              <th className={th}>SKU</th>
              <th className={th}>Warna</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} text-right`}>Harga beli (¥)</th>
              <th className={`${th} text-right`}>Harga beli (Rp)</th>
              <th className={`${th} text-right`}>Landed cost / pcs</th>
              <th className={`${th} text-right`}>Subtotal</th>
            </tr>
          }
          footer={
            <tr>
              <td className={td} colSpan={2}>Total batch</td>
              <td className={tdNum}>{int(qty(items))}</td>
              <td className={td} colSpan={3} />
              <td className={tdNum}>{rp(total(items))}</td>
            </tr>
          }
        >
          {[...groups.entries()].map(([code, rows]) => (
            <Fragment key={code}>
              <tr className="bg-gold-soft/45 hover:!bg-gold-soft/45">
                <td className={`${td} font-semibold text-ink`} colSpan={2}>
                  {code} · {nameOf.get(code) ?? 'Belum dipetakan'}
                </td>
                <td className={`${tdNum} font-semibold`}>{int(qty(rows))}</td>
                <td className={td} colSpan={3} />
                <td className={`${tdNum} font-semibold`}>{rp(total(rows))}</td>
              </tr>
              {rows.map((i) => (
                <tr key={i.id}>
                  <td className={`${td} num text-[13px] text-ink-2`}>{i.sku}</td>
                  <td className={td}>{variantOf.get(i.sku)?.color ?? '—'}</td>
                  <td className={tdNum}>{int(i.qty)}</td>
                  <td className={tdNum}>{i.price_cny == null ? '—' : `¥${i.price_cny.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`}</td>
                  <td className={tdNum}>{i.price_cny == null ? '—' : rp(i.price_cny * rate)}</td>
                  <td className={tdNum}>{rp(landed(i))}</td>
                  <td className={tdNum}>{rp(i.qty * landed(i))}</td>
                </tr>
              ))}
            </Fragment>
          ))}
        </Table>
      )}
    </div>
  )
}

function PurchaseForm({ initial, refs, fallback, onClose, onSaved }: { initial: Form; refs: ReturnType<typeof useRefs>; fallback: number; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Form>(initial)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (k: keyof Purchase, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  const setItem = (i: number, k: string, val: unknown) => setV((x) => ({ ...x, items: x.items.map((it, j) => (j === i ? { ...it, [k]: val } : it)) }))
  const c = costOf(v, v.items, fallback)
  async function save() {
    setBusy(true)
    try {
      const body = { ...v, items: v.items.map((i) => ({ ...i, price_cny: i.price_cny === '' ? null : i.price_cny })) }
      if (v.id) await api.put(`/purchases/${v.id}`, body)
      else await api.post('/purchases', body)
      toast('Pembelian disimpan')
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
      title={v.id ? `Ubah ${v.name}` : 'Batch impor baru'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={busy || !v.name || !v.order_date || !v.items.some((i) => i.sku && i.qty)}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Nama batch">
          <Input value={v.name ?? ''} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Tanggal bayar ke supplier">
          <Input type="date" value={v.order_date ?? ''} onChange={(e) => set('order_date', e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={v.status ?? 'Dipesan'} onChange={(e) => set('status', e.target.value)} options={[...PURCHASE_STATUSES]} />
        </Field>
        <Field label="Tanggal tiba di gudang">
          <Input type="date" value={v.arrival_date ?? ''} onChange={(e) => set('arrival_date', e.target.value)} />
        </Field>
        <Field label="Supplier / jasa impor">
          <Input value={v.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)} />
        </Field>
        <Field label="Kurs (Rp per 1 CNY)">
          <Input type="number" value={v.exchange_rate ?? ''} onChange={(e) => set('exchange_rate', Number(e.target.value))} />
        </Field>
        <Field label="Biaya cargo / jasa impor (Rp)">
          <Input type="number" value={v.cargo_cost ?? ''} onChange={(e) => set('cargo_cost', Number(e.target.value))} />
        </Field>
        <Field label="Biaya lain (kemasan, pajak) (Rp)">
          <Input type="number" value={v.other_cost ?? ''} onChange={(e) => set('other_cost', Number(e.target.value))} />
        </Field>
      </div>

      <div className="mt-6 mb-2 flex items-center justify-between">
        <h4 className="text-[14px] font-semibold text-ink">Isi batch per SKU</h4>
        <Button icon="plus" onClick={() => setV((x) => ({ ...x, items: [...x.items, { sku: '', qty: '', price_cny: '' }] }))}>
          Tambah baris
        </Button>
      </div>
      <div className="rounded-xl border border-line">
        <Table
          head={
            <tr>
              <th className={th}>Produk (SKU)</th>
              <th className={`${th} w-[110px] text-right`}>Qty</th>
              <th className={`${th} w-[140px] text-right`}>Harga beli (CNY/pcs)</th>
              <th className={`${th} w-[50px]`}></th>
            </tr>
          }
        >
          {v.items.map((it, i) => (
            <tr key={i}>
              <td className={td}>
                <Select value={it.sku} onChange={(e) => setItem(i, 'sku', e.target.value)} options={[{ value: '', label: 'Pilih SKU…' }, ...refs.skuOptions]} />
              </td>
              <td className={tdNum}>
                <Input type="number" min={0} className="text-right" value={it.qty} onChange={(e) => setItem(i, 'qty', e.target.value === '' ? '' : Number(e.target.value))} />
              </td>
              <td className={tdNum}>
                <Input
                  type="number"
                  min={0}
                  step="0.1"
                  className="text-right"
                  placeholder="belum tahu"
                  value={it.price_cny ?? ''}
                  onChange={(e) => setItem(i, 'price_cny', e.target.value === '' ? '' : Number(e.target.value))}
                />
              </td>
              <td className={td}>
                <IconButton icon="trash" label="Hapus baris" tone="danger" onClick={() => setV((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }))} />
              </td>
            </tr>
          ))}
        </Table>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3 rounded-xl bg-canvas px-4 py-3 text-[13.5px]">
        <div>
          <div className="text-muted">Total pcs</div>
          <div className="num font-semibold text-ink">{int(c.qty)}</div>
        </div>
        <div>
          <div className="text-muted">Total biaya batch</div>
          <div className="num font-semibold text-ink">{rp(c.total)}</div>
        </div>
        <div>
          <div className="text-muted">Landed cost rata-rata</div>
          <div className="num font-semibold text-ink">{rp(c.perPcs)} / pcs</div>
        </div>
      </div>
      
      <Field label="Catatan" className="mt-4">
        <Textarea value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </Field>
    </Modal>
  )
}
