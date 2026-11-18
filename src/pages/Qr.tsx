import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { StockRow } from '../../shared/metrics'
import { MOVE_KINDS, moveKind, qrUrl, skuFromScan, type MoveDirection, type StockMove } from '../../shared/moves'
import type { Purchase, PurchaseItem } from '../../shared/types'
import { api } from '../lib/api'
import { dateLabel, int, rp, today } from '../lib/format'
import { beep, printLabels, useQrScanner, useQrSvg } from '../lib/qr'
import { useData } from '../lib/useData'
import { Icon } from '../components/Icon'
import { Badge, Button, Callout, Card, confirmDelete, Empty, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Table, Tabs, td, tdNum, th, useToast } from '../components/ui'

type View = 'scan' | 'label' | 'riwayat'
const label = (r?: StockRow) => (r ? `${r.product_name} · ${r.color}` : 'SKU tidak dikenal')

export default function Qr() {
  const [view, setView] = useState<View>('scan')
  const { data: stock, error, reload } = useData<StockRow[]>('/stock')
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <>
      <PageHeader
        title="QR & Gudang"
        subtitle="Label QR per barang, scan barang masuk & keluar"
        actions={
          <Tabs
            value={view}
            onChange={setView}
            items={[
              { value: 'scan', label: 'Scan' },
              { value: 'label', label: 'Cetak label' },
              { value: 'riwayat', label: 'Riwayat' },
            ]}
          />
        }
      />
      {!stock ? <Loading /> : view === 'scan' ? <Scan stock={stock} onSaved={reload} /> : view === 'label' ? <Labels stock={stock} /> : <History stock={stock} onChanged={reload} />}
    </>
  )
}

// ======================= Scan barang masuk & keluar =======================
type Line = { sku: string; qty: number }
function Scan({ stock, onSaved }: { stock: StockRow[]; onSaved: () => void }) {
  const bySku = useMemo(() => new Map(stock.map((r) => [r.sku, r])), [stock])
  const [dir, setDir] = useState<MoveDirection>('keluar')
  const [kind, setKind] = useState('packing')
  const [batchId, setBatchId] = useState('')
  const [note, setNote] = useState('')
  const [date, setDate] = useState(today())
  const [lines, setLines] = useState<Line[]>([])
  const [last, setLast] = useState<{ text: string; ok: boolean } | null>(null)
  const [manual, setManual] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const { data: pur } = useData<{ purchases: Purchase[]; items: PurchaseItem[] }>('/purchases')
  const openBatches = (pur?.purchases ?? []).filter((p) => p.status !== 'Tiba')
  const expected = useMemo(() => {
    const m = new Map<string, number>()
    for (const it of pur?.items ?? []) if (String(it.purchase_id) === batchId) m.set(it.sku, (m.get(it.sku) ?? 0) + it.qty)
    return m
  }, [pur, batchId])
  const kinds = MOVE_KINDS.filter((k) => k.direction === dir)
  const k = moveKind(kind)!

  const add = (sku: string, n = 1) => setLines((ls) => (ls.some((l) => l.sku === sku) ? ls.map((l) => (l.sku === sku ? { ...l, qty: Math.max(0, l.qty + n) } : l)) : [{ sku, qty: n }, ...ls]))
  const scanner = useQrScanner((text) => {
    const sku = skuFromScan(text)
    if (sku && bySku.has(sku)) {
      add(sku)
      beep(true)
      setLast({ text: `${sku} · ${label(bySku.get(sku))}`, ok: true })
    } else {
      beep(false)
      setLast({ text: `Tidak dikenal: ${text.slice(0, 60)}`, ok: false })
    }
  })
  const total = lines.reduce((a, l) => a + l.qty, 0)
  const setDirection = (d: MoveDirection) => {
    setDir(d)
    setKind(MOVE_KINDS.find((x) => x.direction === d)!.value)
    setBatchId('')
  }
  async function save() {
    setBusy(true)
    try {
      if (kind === 'penerimaan') {
        if (!batchId) throw new Error('Pilih batch yang diterima')
        const r = await api.post<{ diffs: { sku: string; diff: number }[] }>('/stock/receive', { purchase_id: Number(batchId), date, items: lines })
        toast(r.diffs.length ? `Batch diterima, ${r.diffs.length} SKU selisih dicatat` : 'Batch diterima, jumlah sesuai')
        setBatchId('')
      } else {
        const r = await api.post<{ count: number }>('/stock/moves', { date, kind, note, items: lines.filter((l) => l.qty > 0) })
        toast(`${int(r.count)} pcs ${dir === 'masuk' ? 'masuk' : 'keluar'} tercatat`)
      }
      setLines([])
      setNote('')
      onSaved()
      window.dispatchEvent(new Event('g88:refresh'))
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  const rows = kind === 'penerimaan' && batchId ? [...new Set([...lines.map((l) => l.sku), ...expected.keys()])] : lines.map((l) => l.sku)
  const qtyOf = (sku: string) => lines.find((l) => l.sku === sku)?.qty ?? 0

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1.2fr]">
      <div className="flex flex-col gap-4">
        <Card title="1 · Jenis catatan">
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-2">
              {(['masuk', 'keluar'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDirection(d)}
                  className={`flex h-11 items-center justify-center gap-2 rounded-xl border text-[14.5px] font-semibold transition-colors ${dir === d ? (d === 'masuk' ? 'border-good bg-good-soft text-good' : 'border-bad bg-bad-soft text-bad') : 'border-line bg-white text-ink-2'}`}
                >
                  <Icon name={d === 'masuk' ? 'download' : 'upload'} size={16} /> Barang {d}
                </button>
              ))}
            </div>
            <Field label="Jenis" hint={k.hint}>
              <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds.map((x) => ({ value: x.value, label: x.label }))} />
            </Field>
            {kind === 'penerimaan' ? (
              <Field label="Batch yang diterima" hint={openBatches.length ? 'Hanya batch yang belum tercatat tiba' : 'Tidak ada batch yang sedang dalam perjalanan'}>
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} options={[{ value: '', label: 'Pilih batch…' }, ...openBatches.map((p) => ({ value: String(p.id), label: `${p.name} · ${dateLabel(p.order_date)}` }))]} />
              </Field>
            ) : (
              <Field label="Catatan (opsional)">
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={dir === 'keluar' ? 'Contoh: sampel untuk endorse @nama' : 'Contoh: ditemukan di gudang belakang'} />
              </Field>
            )}
            <Field label="Tanggal">
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
          </div>
        </Card>

        <Card
          title="2 · Scan QR barang"
          actions={
            scanner.active ? (
              <Button onClick={scanner.stop}>Matikan kamera</Button>
            ) : (
              <Button variant="primary" icon="camera" onClick={scanner.start}>
                Buka kamera
              </Button>
            )
          }
        >
          <div className={`relative overflow-hidden rounded-2xl bg-ink ${scanner.active ? '' : 'hidden'}`}>
            <video ref={scanner.videoRef} className="aspect-[4/3] w-full object-cover" muted playsInline />
            <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80" />
          </div>
          {!scanner.active && <p className="text-[13.5px] text-muted">Arahkan kamera ke QR di label barang. Setiap barang yang terbaca menambah 1 pcs. Satu barang dibaca sekali, lalu ganti barang berikutnya.</p>}
          {scanner.error && (
            <div className="mt-3">
              <Callout tone="warning" title="Kamera tidak bisa dibuka">
                {scanner.error}
              </Callout>
            </div>
          )}
          {last && (
            <div className={`mt-3 rounded-xl px-3 py-2 text-[13.5px] font-medium ${last.ok ? 'bg-good-soft text-good' : 'bg-bad-soft text-bad'}`}>
              {last.ok ? '✓ ' : '✗ '}
              {last.text}
            </div>
          )}
          <div className="mt-4 flex items-end gap-2">
            <Field label="Atau tambah manual" className="flex-1">
              <Select value={manual} onChange={(e) => setManual(e.target.value)} options={[{ value: '', label: 'Pilih SKU…' }, ...stock.filter((r) => r.category !== 'Kemasan').map((r) => ({ value: r.sku, label: `${r.sku} — ${label(r)}` }))]} />
            </Field>
            <Button
              icon="plus"
              disabled={!manual}
              onClick={() => {
                add(manual)
                setManual('')
              }}
            >
              Tambah
            </Button>
          </div>
        </Card>
      </div>

      <Card
        title="3 · Periksa & simpan"
        subtitle={`${int(total)} pcs · ${lines.filter((l) => l.qty > 0).length} SKU`}
        padded={false}
        actions={
          <Button variant="primary" icon="check" onClick={save} disabled={busy || (kind === 'penerimaan' ? !batchId : !total)}>
            {busy ? 'Menyimpan…' : kind === 'penerimaan' ? 'Terima batch' : 'Simpan'}
          </Button>
        }
      >
        {!rows.length ? (
          <div className="p-5">
            <Empty title="Belum ada barang">{kind === 'penerimaan' && !batchId ? 'Pilih batch dulu, lalu scan barang yang datang.' : 'Scan QR atau tambah manual.'}</Empty>
          </div>
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Barang</th>
                {kind === 'penerimaan' && batchId && <th className={`${th} text-right`}>Isi batch</th>}
                <th className={`${th} text-center`}>{kind === 'penerimaan' ? 'Diterima' : 'Jumlah'}</th>
                {kind !== 'penerimaan' && <th className={`${th} text-right`}>Stok sistem</th>}
                <th className={th}></th>
              </tr>
            }
          >
            {rows.map((sku) => {
              const r = bySku.get(sku)
              const q = qtyOf(sku)
              const exp = expected.get(sku) ?? 0
              const diff = q - exp
              return (
                <tr key={sku}>
                  <td className={td}>
                    <div className="font-medium text-ink">{label(r)}</div>
                    <div className="text-[12px] text-muted">{sku}</div>
                  </td>
                  {kind === 'penerimaan' && batchId && <td className={tdNum}>{int(exp)}</td>}
                  <td className={td}>
                    <div className="flex items-center justify-center gap-1">
                      <IconButton icon="minus" label="Kurangi" onClick={() => add(sku, -1)} />
                      <div className="w-16 shrink-0">
                        <Input
                          className="h-8 px-1 text-center"
                          type="number"
                          min={0}
                          aria-label={`Jumlah ${sku}`}
                          value={q}
                          onChange={(e) => {
                            const v = Math.max(0, Number(e.target.value) || 0)
                            setLines((ls) => (ls.some((l) => l.sku === sku) ? ls.map((l) => (l.sku === sku ? { ...l, qty: v } : l)) : [{ sku, qty: v }, ...ls]))
                          }}
                        />
                      </div>
                      <IconButton icon="plus" label="Tambah" onClick={() => add(sku, 1)} />
                    </div>
                    {kind === 'penerimaan' && batchId && diff !== 0 && <div className={`mt-1 text-center text-[12px] font-medium ${diff > 0 ? 'text-good' : 'text-bad'}`}>{diff > 0 ? `lebih ${diff}` : `kurang ${-diff}`}</div>}
                  </td>
                  {kind !== 'penerimaan' && (
                    <td className={`${tdNum} ${dir === 'keluar' && r && q > r.onHand ? 'text-bad' : ''}`}>
                      {r ? int(Math.max(0, r.onHand)) : '–'}
                    </td>
                  )}
                  <td className={`${td} text-right`}>
                    <IconButton icon="trash" label="Hapus baris" tone="danger" onClick={() => setLines((ls) => ls.filter((l) => l.sku !== sku))} />
                  </td>
                </tr>
              )
            })}
          </Table>
        )}
        <div className="border-t border-line-soft px-5 py-3 text-[12.5px] text-muted">
          {kind === 'penerimaan'
            ? 'Setelah disimpan, batch berubah jadi "Tiba". Selisih jumlah diterima dengan isi batch dicatat sebagai penyesuaian stok.'
            : k.affectsStock
              ? `Stok sistem ${dir === 'masuk' ? 'bertambah' : 'berkurang'} sesuai jumlah di atas.`
              : 'Catatan saja: stok sistem tidak berubah karena sudah dihitung dari data penjualan.'}
        </div>
      </Card>
    </div>
  )
}

// ======================= Cetak label =======================
function Labels({ stock }: { stock: StockRow[] }) {
  const items = stock.filter((r) => r.category !== 'Kemasan')
  const [copies, setCopies] = useState<Record<string, number>>({})
  const [size, setSize] = useState<'thermal' | 'a4'>('a4')
  const [q, setQ] = useState('')
  const [batchId, setBatchId] = useState('')
  const toast = useToast()
  const { data: pur } = useData<{ purchases: Purchase[]; items: PurchaseItem[] }>('/purchases')
  const shown = items.filter((r) => !q || `${r.sku} ${r.product_name} ${r.color}`.toLowerCase().includes(q.toLowerCase()))
  const total = Object.values(copies).reduce((a, n) => a + (n || 0), 0)
  const fill = (f: (r: StockRow) => number) => setCopies(Object.fromEntries(items.map((r) => [r.sku, Math.max(0, Math.round(f(r)))])))
  function fromBatch(id: string) {
    setBatchId(id)
    if (!id) return
    const m = new Map<string, number>()
    for (const it of pur?.items ?? []) if (String(it.purchase_id) === id) m.set(it.sku, (m.get(it.sku) ?? 0) + it.qty)
    fill((r) => m.get(r.sku) ?? 0)
  }
  async function print() {
    try {
      await printLabels(
        items.filter((r) => (copies[r.sku] ?? 0) > 0).map((r) => ({ sku: r.sku, title: r.product_name, color: r.color, price: r.listPrice, copies: copies[r.sku] })),
        size,
        window.location.origin,
      )
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start gap-3">
          <Field label="Isi jumlah dari" hint="Atau ketik jumlah label per SKU di tabel" className="w-full sm:w-[260px]">
            <Select value={batchId} onChange={(e) => fromBatch(e.target.value)} options={[{ value: '', label: 'Pilih batch impor…' }, ...(pur?.purchases ?? []).map((p) => ({ value: String(p.id), label: `${p.name} · ${p.status}` }))]} />
          </Field>
          <Field label="Ukuran label" hint={size === 'a4' ? '40 label per lembar A4 (±48 × 28 mm)' : 'Printer thermal, 1 label per stiker'} className="w-full sm:w-[230px]">
            <Select
              value={size}
              onChange={(e) => setSize(e.target.value as 'thermal' | 'a4')}
              options={[
                { value: 'a4', label: 'Kertas A4 (4 × 10)' },
                { value: 'thermal', label: 'Stiker thermal 50 × 30 mm' },
              ]}
            />
          </Field>
          <div className="flex w-full flex-wrap gap-2 sm:ml-auto sm:w-auto sm:pt-[26px]">
            <Button
              onClick={() => {
                setBatchId('')
                fill((r) => Math.max(0, r.onHand))
              }}
            >
              Isi = stok gudang
            </Button>
            <Button
              onClick={() => {
                setBatchId('')
                setCopies({})
              }}
            >
              Kosongkan
            </Button>
            <Button variant="primary" icon="printer" onClick={print} disabled={!total}>
              Cetak {total ? `${int(total)} label` : ''}
            </Button>
          </div>
        </div>
      </Card>
      <Card
        padded={false}
        title="Jumlah label per SKU"
        subtitle="Satu label untuk satu pcs barang. Isi QR = tautan ke halaman SKU di portal."
        actions={
          <div className="w-full sm:w-[220px]">
            <Input className="h-9" placeholder="Cari SKU / model / warna" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari SKU" />
          </div>
        }
      >
        <Table
          head={
            <tr>
              <th className={th}>Barang</th>
              <th className={`${th} text-right`}>Stok gudang</th>
              <th className={`${th} text-right`}>Harga katalog</th>
              <th className={`${th} text-center`}>Jumlah label</th>
            </tr>
          }
        >
          {shown.map((r) => (
            <tr key={r.sku}>
              <td className={td}>
                <Link to={`/qr/${encodeURIComponent(r.sku)}`} className="font-medium text-ink hover:text-navy hover:underline">
                  {label(r)}
                </Link>
                <div className="text-[12px] text-muted">{r.sku}</div>
              </td>
              <td className={tdNum}>{int(Math.max(0, r.onHand))}</td>
              <td className={tdNum}>{r.listPrice ? rp(r.listPrice) : '–'}</td>
              <td className={td}>
                <div className="mx-auto w-20">
                  <Input className="h-8 px-1 text-center" type="number" min={0} value={copies[r.sku] ?? 0} onChange={(e) => setCopies({ ...copies, [r.sku]: Math.max(0, Number(e.target.value) || 0) })} aria-label={`Jumlah label ${r.sku}`} />
                </div>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  )
}

// ======================= Riwayat =======================
function History({ stock, onChanged }: { stock: StockRow[]; onChanged: () => void }) {
  const bySku = new Map(stock.map((r) => [r.sku, r]))
  const { data, reload } = useData<StockMove[]>('/stock/moves')
  const toast = useToast()
  async function undo(m: StockMove) {
    if (!confirmDelete(`catatan ${m.direction} ${m.qty} pcs ${m.sku}${m.adjustment_id ? ' (penyesuaian stoknya ikut dibatalkan)' : ''}`)) return
    try {
      await api.del(`/stock/moves/${m.id}`)
      toast('Catatan dibatalkan')
      reload()
      onChanged()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  if (!data) return <Loading />
  return <MovesTable rows={data} bySku={bySku} onUndo={undo} />
}

function MovesTable({ rows, bySku, onUndo, compact }: { rows: StockMove[]; bySku: Map<string, StockRow>; onUndo?: (m: StockMove) => void; compact?: boolean }) {
  if (!rows.length) return <Card><Empty title="Belum ada catatan keluar-masuk" /></Card>
  return (
    <Card padded={false} title={compact ? 'Riwayat keluar-masuk' : undefined}>
      <Table
        head={
          <tr>
            <th className={th}>Tanggal</th>
            {!compact && <th className={th}>Barang</th>}
            <th className={th}>Jenis</th>
            <th className={`${th} text-right`}>Jumlah</th>
            <th className={th}>Oleh</th>
            {onUndo && <th className={th}></th>}
          </tr>
        }
      >
        {rows.map((m) => {
          const k = moveKind(m.kind)
          return (
            <tr key={m.id}>
              <td className={`${td} whitespace-nowrap text-ink-2`}>{dateLabel(m.move_date)}</td>
              {!compact && (
                <td className={td}>
                  <div className="font-medium text-ink">{label(bySku.get(m.sku))}</div>
                  <div className="text-[12px] text-muted">{m.sku}</div>
                </td>
              )}
              <td className={td}>
                <div className="text-ink">{k?.label ?? m.kind}</div>
                {(m.ref || m.note) && <div className="text-[12px] text-muted">{[m.ref, m.note].filter(Boolean).join(' · ')}</div>}
                {!k?.affectsStock && m.kind !== 'penerimaan' && <Badge>catatan saja</Badge>}
              </td>
              <td className={`${tdNum} font-semibold ${m.direction === 'masuk' ? 'text-good' : 'text-bad'}`}>
                {m.direction === 'masuk' ? '+' : '−'}
                {int(m.qty)}
              </td>
              <td className={`${td} whitespace-nowrap text-ink-2`}>{m.user_name ?? '–'}</td>
              {onUndo && (
                <td className={`${td} text-right`}>
                  <IconButton icon="trash" label="Batalkan catatan" tone="danger" onClick={() => onUndo(m)} />
                </td>
              )}
            </tr>
          )
        })}
      </Table>
    </Card>
  )
}

// ======================= Halaman SKU (tujuan scan dari kamera HP) =======================
export function QrSku() {
  const { sku = '' } = useParams()
  const { data: stock, error, reload } = useData<StockRow[]>('/stock')
  const { data: moves, reload: reloadMoves } = useData<StockMove[]>(`/stock/moves?sku=${encodeURIComponent(sku)}`)
  const svg = useQrSvg(sku ? qrUrl(window.location.origin, sku) : null)
  const [form, setForm] = useState<MoveDirection | null>(null)
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!stock) return <Loading />
  const r = stock.find((x) => x.sku === sku)
  const bySku = new Map(stock.map((x) => [x.sku, x]))
  return (
    <>
      <PageHeader
        title={r ? r.product_name : 'SKU tidak dikenal'}
        subtitle={r ? `${r.color} · ${sku}` : sku}
        actions={
          <Link to="/qr">
            <Button icon="qr">QR & Gudang</Button>
          </Link>
        }
      />
      {!r ? (
        <Callout tone="warning" title="SKU ini belum ada di portal">
          Periksa label atau tambahkan varian ini di Produk & Stok.
        </Callout>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[1fr_220px]">
            <Card>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  ['Stok gudang', `${int(Math.max(0, r.onHand))} pcs`],
                  ['Dalam perjalanan', `${int(r.inTransit)} pcs`],
                  ['Terjual (neto)', `${int(r.soldNet)} pcs`],
                  ['Harga katalog', r.listPrice ? rp(r.listPrice) : '–'],
                  ['Harga jual rata-rata', r.avgSell ? rp(r.avgSell) : '–'],
                  ['Modal per pcs', rp(r.landed)],
                  ['Terakhir terjual', r.lastSale ? dateLabel(r.lastSale.slice(0, 10)) : 'Belum pernah'],
                  ['Model', r.product_code],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[12.5px] text-muted">{k}</dt>
                    <dd className="num text-[16px] font-semibold text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-5 grid grid-cols-2 gap-2 sm:flex">
                <Button className="h-11 border-good text-good" icon="download" onClick={() => setForm('masuk')}>
                  Catat masuk
                </Button>
                <Button className="h-11 border-bad text-bad" icon="upload" onClick={() => setForm('keluar')}>
                  Catat keluar
                </Button>
              </div>
            </Card>
            <Card>
              <div className="mx-auto w-[150px] [&_svg]:h-auto [&_svg]:w-full" dangerouslySetInnerHTML={{ __html: svg ?? '' }} />
              <p className="mt-2 text-center text-[12px] text-muted">QR barang ini</p>
            </Card>
          </div>
          <div className="mt-4">{moves ? <MovesTable rows={moves} bySku={bySku} compact /> : <Loading />}</div>
          {form && (
            <QuickMove
              sku={sku}
              dir={form}
              max={Math.max(0, r.onHand)}
              onClose={() => setForm(null)}
              onSaved={() => {
                reload()
                reloadMoves()
              }}
            />
          )}
        </>
      )}
    </>
  )
}

function QuickMove({ sku, dir, max, onClose, onSaved }: { sku: string; dir: MoveDirection; max: number; onClose: () => void; onSaved: () => void }) {
  const kinds = MOVE_KINDS.filter((k) => k.direction === dir && k.value !== 'penerimaan')
  const [kind, setKind] = useState(kinds[0].value)
  const [qty, setQty] = useState(1)
  const [note, setNote] = useState('')
  const toast = useToast()
  const k = moveKind(kind)!
  async function save() {
    try {
      await api.post('/stock/moves', { date: today(), kind, note, items: [{ sku, qty }] })
      toast(`${qty} pcs ${dir} tercatat`)
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <Modal
      open
      title={`Catat barang ${dir}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={qty < 1}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Jenis" hint={k.hint}>
          <Select value={kind} onChange={(e) => setKind(e.target.value)} options={kinds.map((x) => ({ value: x.value, label: x.label }))} />
        </Field>
        <Field label="Jumlah (pcs)" hint={dir === 'keluar' && k.affectsStock && qty > max ? `Melebihi stok sistem (${max} pcs)` : undefined}>
          <Input type="number" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </Field>
        <Field label="Catatan (opsional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
