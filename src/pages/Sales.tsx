import { useMemo, useState } from 'react'
import readXlsxFile from 'read-excel-file'
import { Link } from 'react-router-dom'
import { parseCsv, parseTikTokRows, type ParseResult } from '../../shared/tiktok'
import { SALE_STATUSES, type Sale } from '../../shared/types'
import { api, qs } from '../lib/api'
import { dateLabel, int, rp, today } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import {
  Badge,
  Button,
  Callout,
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
  Tabs,
  td,
  tdNum,
  th,
  Textarea,
  useToast,
} from '../components/ui'

const statusTone: Record<string, 'neutral' | 'bad' | 'warn' | 'info' | 'good'> = {
  Normal: 'neutral',
  Retur: 'bad',
  'Retur tidak jadi': 'info',
  'Cancel ditolak': 'info',
  Batal: 'warn',
}

export default function Sales() {
  const [tab, setTab] = useState<'data' | 'upload'>('data')
  const [editing, setEditing] = useState<Partial<Sale> | null>(null)
  const refs = useRefs()
  return (
    <>
      <PageHeader
        title="Penjualan"
        subtitle="Unggah file export order TikTok Shop setiap hari, atau catat penjualan secara manual."
        actions={
          <>
            <Tabs
              value={tab}
              onChange={setTab}
              items={[
                { value: 'data', label: 'Data penjualan' },
                { value: 'upload', label: 'Unggah export TikTok' },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={() => setEditing({ order_date: `${today()} 12:00:00`, qty: 1, status: 'Normal', store: refs.stores[0] })}>
              Input manual
            </Button>
          </>
        }
      />
      {tab === 'data' ? <SalesList onEdit={setEditing} refs={refs} /> : <Upload stores={refs.stores} onDone={() => setTab('data')} />}
      {editing && <SaleForm initial={editing} refs={refs} onClose={() => setEditing(null)} />}
    </>
  )
}

function SalesList({ onEdit, refs }: { onEdit: (s: Sale) => void; refs: ReturnType<typeof useRefs> }) {
  const [f, setF] = useState({ from: '', to: '', store: '', status: '', q: '' })
  const { data, error, reload } = useData<Sale[]>(`/sales${qs(f)}`)
  const toast = useToast()
  const [page, setPage] = useState(0)
  const PER = 50
  const totals = useMemo(() => {
    const rows = data ?? []
    const net = rows.reduce((a, s) => a + s.qty - s.return_qty - s.cancel_qty, 0)
    const omzet = rows.reduce((a, s) => a + (s.qty - s.return_qty - s.cancel_qty) * s.unit_price, 0)
    const orders = new Set(rows.map((s) => s.store + s.order_id)).size
    return { net, omzet, orders, lines: rows.length }
  }, [data])
  async function remove(s: Sale) {
    if (!confirmDelete(`penjualan ${s.order_id}`)) return
    await api.del(`/sales/${s.id}`)
    toast('Penjualan dihapus')
    reload()
  }
  if (error) return <ErrorBox message={error} onRetry={reload} />
  const rows = data ?? []
  const shown = rows.slice(page * PER, page * PER + PER)
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Pesanan" value={int(totals.orders)} hint={`${int(totals.lines)} baris produk`} />
        <Stat label="Produk terjual (neto)" value={`${int(totals.net)} pcs`} />
        <Stat label="Omzet neto" value={rp(totals.omzet, { compact: true })} />
        <Stat label="Rata-rata per pcs" value={rp(totals.net ? totals.omzet / totals.net : 0, { compact: true })} />
      </div>
      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-2 border-b border-line-soft px-5 py-4">
          <Field label="Dari bulan">
            <Input type="month" className="h-9 w-[150px]" value={f.from} onChange={(e) => (setF({ ...f, from: e.target.value }), setPage(0))} />
          </Field>
          <Field label="Sampai bulan">
            <Input type="month" className="h-9 w-[150px]" value={f.to} onChange={(e) => (setF({ ...f, to: e.target.value }), setPage(0))} />
          </Field>
          <Field label="Toko">
            <Select
              className="h-9 w-[160px]"
              value={f.store}
              onChange={(e) => (setF({ ...f, store: e.target.value }), setPage(0))}
              options={[{ value: '', label: 'Semua toko' }, ...refs.stores]}
            />
          </Field>
          <Field label="Status">
            <Select
              className="h-9 w-[160px]"
              value={f.status}
              onChange={(e) => (setF({ ...f, status: e.target.value }), setPage(0))}
              options={[{ value: '', label: 'Semua status' }, ...SALE_STATUSES]}
            />
          </Field>
          <Field label="Cari" className="min-w-[200px] flex-1">
            <Input className="h-9" placeholder="No. order, SKU, nama produk" value={f.q} onChange={(e) => (setF({ ...f, q: e.target.value }), setPage(0))} />
          </Field>
        </div>
        {!data ? (
          <Loading />
        ) : !rows.length ? (
          <div className="p-5">
            <Empty title="Belum ada penjualan pada filter ini">Unggah export TikTok atau tambahkan penjualan manual.</Empty>
          </div>
        ) : (
          <>
            <Table
              head={
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Toko</th>
                  <th className={th}>Produk</th>
                  <th className={`${th} text-right`}>Qty</th>
                  <th className={th}>Status</th>
                  <th className={`${th} text-right`}>Harga</th>
                  <th className={`${th} text-right`}>Omzet neto</th>
                  <th className={th}></th>
                </tr>
              }
            >
              {shown.map((s) => {
                const net = s.qty - s.return_qty - s.cancel_qty
                return (
                  <tr key={s.id}>
                    <td className={`${td} whitespace-nowrap text-ink-2`}>{dateLabel(s.order_date)}</td>
                    <td className={`${td} whitespace-nowrap`}>{s.store}</td>
                    <td className={td}>
                      <div className="font-medium text-ink">{refs.variantLabel(s.sku)}</div>
                      <div className="text-[12px] text-muted">
                        {s.sku ?? s.platform_sku_id} · #{s.order_id}
                        {s.source === 'manual' && ' · manual'}
                      </div>
                    </td>
                    <td className={tdNum}>
                      {s.qty}
                      {s.return_qty + s.cancel_qty > 0 && <span className="text-bad"> −{s.return_qty + s.cancel_qty}</span>}
                    </td>
                    <td className={td}>
                      <Badge tone={statusTone[s.status] ?? 'neutral'}>{s.status}</Badge>
                    </td>
                    <td className={tdNum}>{rp(s.unit_price)}</td>
                    <td className={`${tdNum} font-medium`}>{rp(net * s.unit_price)}</td>
                    <td className={`${td} whitespace-nowrap text-right`}>
                      {s.source === 'manual' && <IconButton icon="edit" label="Ubah" onClick={() => onEdit(s)} />}
                      <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => remove(s)} />
                    </td>
                  </tr>
                )
              })}
            </Table>
            <div className="flex items-center justify-between border-t border-line-soft px-5 py-3 text-[13px] text-muted">
              <span>
                Menampilkan {page * PER + 1}–{Math.min(rows.length, page * PER + PER)} dari {int(rows.length)} baris
                {rows.length >= 2000 && ' (maksimum 2.000, persempit filter)'}
              </span>
              <div className="flex gap-2">
                <Button disabled={page === 0} onClick={() => setPage(page - 1)}>
                  Sebelumnya
                </Button>
                <Button disabled={(page + 1) * PER >= rows.length} onClick={() => setPage(page + 1)}>
                  Berikutnya
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>
    </>
  )
}

function Upload({ stores, onDone }: { stores: string[]; onDone: () => void }) {
  const [store, setStore] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<ParseResult | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ received: number; inserted: number; updated: number; unmapped: number } | null>(null)
  const toast = useToast()

  async function read(fl: File) {
    setFile(fl)
    setParsed(null)
    setErr(null)
    setResult(null)
    try {
      let rows: unknown[][]
      if (/\.csv$/i.test(fl.name)) rows = parseCsv(await fl.text())
      else rows = (await readXlsxFile(fl)) as unknown[][]
      setParsed(parseTikTokRows(rows as never))
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function save() {
    if (!parsed || !store) return
    setBusy(true)
    try {
      const r = await api.post<{ received: number; inserted: number; updated: number; unmapped: number }>('/sales/import', { store, lines: parsed.lines })
      setResult(r)
      toast(`${r.inserted} baris baru, ${r.updated} diperbarui`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const summary = useMemo(() => {
    if (!parsed) return null
    const by: Record<string, number> = {}
    for (const l of parsed.lines) by[l.status] = (by[l.status] ?? 0) + l.qty
    const omzet = parsed.lines.reduce((a, l) => a + (l.qty - l.return_qty - l.cancel_qty) * l.unit_price, 0)
    return { by, omzet, orders: new Set(parsed.lines.map((l) => l.order_id)).size }
  }, [parsed])

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <Card title="1. Pilih toko & file" subtitle="Seller Center → Pesanan → Ekspor (Order SKU List). Format .xlsx atau .csv.">
        <div className="flex flex-col gap-4">
          <Field label="Toko asal file">
            <Select value={store} onChange={(e) => setStore(e.target.value)} options={[{ value: '', label: 'Pilih toko…' }, ...stores]} />
          </Field>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-canvas/50 px-6 py-10 text-center transition-colors hover:border-gold">
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
            <span className="text-[15px] font-medium text-navy">{file ? file.name : 'Klik untuk memilih file'}</span>
            <span className="mt-1 text-[13px] text-muted">Data yang sudah ada akan diperbarui, bukan diduplikasi.</span>
          </label>
          {err && <Callout tone="critical" title="File tidak bisa dibaca">{err}</Callout>}
          <Callout tone="info" title="Cara status dibaca otomatis">
            Retur dihitung hanya jika ada qty retur. Retur yang tidak jadi dan permintaan cancel yang ditolak penjual (barang sampai &amp; dibayar) tetap
            dihitung terjual.
          </Callout>
        </div>
      </Card>
      <Card title="2. Periksa & simpan">
        {!parsed || !summary ? (
          <Empty title="Belum ada file">Ringkasan isi file akan muncul di sini sebelum disimpan.</Empty>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3">
              <Stat label="Baris produk" value={int(parsed.lines.length)} hint={`${int(summary.orders)} pesanan`} />
              <Stat label="Omzet neto" value={rp(summary.omzet, { compact: true })} />
            </div>
            <div className="text-[14px] text-ink-2">
              Periode: <b>{dateLabel(parsed.dateRange?.[0])}</b> s.d. <b>{dateLabel(parsed.dateRange?.[1])}</b>
              {parsed.skipped > 0 && <span className="text-muted"> · {parsed.skipped} baris non-order dilewati</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(summary.by).map(([s, q]) => (
                <Badge key={s} tone={statusTone[s] ?? 'neutral'}>
                  {s}: {q} pcs
                </Badge>
              ))}
            </div>
            {parsed.warnings.slice(0, 3).map((w) => (
              <Callout key={w} tone="warning" title="Peringatan">
                {w}
              </Callout>
            ))}
            {result ? (
              <Callout tone="good" title="Data tersimpan">
                {result.inserted} baris baru, {result.updated} diperbarui.{' '}
                {result.unmapped > 0 && (
                  <>
                    Ada <b>{result.unmapped}</b> baris yang SKU-nya belum dikenali.{' '}
                    <Link to="/pengaturan" className="font-medium text-navy underline">
                      Petakan di Pengaturan
                    </Link>
                    .
                  </>
                )}{' '}
                <button className="font-medium text-navy underline" onClick={onDone}>
                  Lihat data
                </button>
              </Callout>
            ) : (
              <Button variant="primary" icon="upload" onClick={save} disabled={busy || !store}>
                {busy ? 'Menyimpan…' : store ? `Simpan ke ${store}` : 'Pilih toko dulu'}
              </Button>
            )}
          </div>
        )}
      </Card>
    </div>
  )
}

function SaleForm({ initial, refs, onClose }: { initial: Partial<Sale>; refs: ReturnType<typeof useRefs>; onClose: () => void }) {
  const [v, setV] = useState<Partial<Sale>>(initial)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = (k: keyof Sale, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  async function save() {
    setBusy(true)
    try {
      if (v.id) await api.put(`/sales/${v.id}`, v)
      else await api.post('/sales', v)
      toast('Penjualan disimpan')
      onClose()
      window.dispatchEvent(new Event('g88:refresh'))
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      open
      title={v.id ? 'Ubah penjualan manual' : 'Input penjualan manual'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={busy || !v.sku || !v.store || !v.qty || !v.unit_price}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tanggal">
          <Input type="date" value={(v.order_date ?? '').slice(0, 10)} onChange={(e) => set('order_date', `${e.target.value} 12:00:00`)} />
        </Field>
        <Field label="Toko / kanal">
          <Select value={v.store ?? ''} onChange={(e) => set('store', e.target.value)} options={[{ value: '', label: 'Pilih…' }, ...refs.stores]} />
        </Field>
        <Field label="Produk (SKU)" className="col-span-2">
          <Select
            value={v.sku ?? ''}
            onChange={(e) => {
              const price = refs.variants.find((x) => x.sku === e.target.value)?.price
              setV((x) => ({ ...x, sku: e.target.value, unit_price: x.unit_price || price || undefined }))
            }}
            options={[{ value: '', label: 'Pilih produk…' }, ...refs.skuOptions]}
          />
        </Field>
        <Field label="Jumlah (pcs)">
          <Input type="number" min={1} value={v.qty ?? ''} onChange={(e) => set('qty', Number(e.target.value))} />
        </Field>
        <Field label="Harga jual per pcs (Rp)" hint="Setelah diskon toko">
          <Input type="number" min={0} value={v.unit_price ?? ''} onChange={(e) => set('unit_price', Number(e.target.value))} />
        </Field>
        <Field label="Status">
          <Select value={v.status ?? 'Normal'} onChange={(e) => set('status', e.target.value)} options={SALE_STATUSES} />
        </Field>
        {v.status === 'Retur' && (
          <Field label="Qty diretur">
            <Input type="number" min={1} max={v.qty} value={v.return_qty ?? v.qty ?? ''} onChange={(e) => set('return_qty', Number(e.target.value))} />
          </Field>
        )}
        <Field label="No. order (opsional)" className={v.status === 'Retur' ? 'col-span-2' : ''}>
          <Input value={v.order_id ?? ''} onChange={(e) => set('order_id', e.target.value)} placeholder="Otomatis jika kosong" disabled={!!v.id} />
        </Field>
        <Field label="Catatan" className="col-span-2">
          <Textarea value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
      {v.qty && v.unit_price ? (
        <p className="mt-4 text-[14px] text-ink-2">
          Omzet: <b className="num">{rp((v.qty - (v.status === 'Retur' ? v.return_qty ?? v.qty : 0) - (v.status === 'Batal' ? v.qty : 0)) * v.unit_price)}</b>
        </p>
      ) : null}
    </Modal>
  )
}
