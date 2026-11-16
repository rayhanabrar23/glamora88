import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { int } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import { Button, Callout, Card, confirmDelete, Field, IconButton, Input, PageHeader, Select, Table, td, tdNum, th, useToast } from '../components/ui'
import type { Store } from '../../shared/types'
import { parseTeamCommission, type TeamMember } from '../../shared/commission'
import { lockOwner, OwnerGate } from '../components/OwnerGate'

const FIELDS: { key: string; label: string; hint: string; kind: 'pct' | 'rp' | 'num' }[] = [
  { key: 'platform_commission_pct', label: 'Komisi platform', hint: 'Persen dari harga jual', kind: 'pct' },
  { key: 'dynamic_commission_pct', label: 'Komisi dinamis', hint: 'Persen dari harga jual', kind: 'pct' },
  { key: 'order_processing_fee', label: 'Biaya pemrosesan per pesanan', hint: 'Rupiah per pesanan', kind: 'rp' },
  { key: 'heavy_parcel_fee', label: 'Fee pengiriman paket berat', hint: 'Rupiah per pesanan di atas batas berat', kind: 'rp' },
  { key: 'heavy_parcel_threshold_kg', label: 'Batas berat paket (kg)', hint: 'Default 0,3 kg', kind: 'num' },
  { key: 'heavy_parcel_share_fallback', label: 'Porsi paket berat (cadangan)', hint: 'Jika data berat kosong', kind: 'pct' },
  { key: 'live_attribution_buffer_min', label: 'Toleransi penjualan setelah live (menit)', hint: 'Menit setelah live selesai', kind: 'num' },
  { key: 'fallback_landed_cost', label: 'Landed cost cadangan', hint: 'SKU tanpa harga beli', kind: 'rp' },
  { key: 'planned_fixed_cost', label: 'Rencana biaya tetap per bulan', hint: 'Untuk titik impas rencana', kind: 'rp' },
]

export default function Settings() {
  return (
    <OwnerGate title="Pengaturan">
      <SettingsBody />
    </OwnerGate>
  )
}

function SettingsBody() {
  const refs = useRefs()
  return (
    <>
      <PageHeader
        title="Pengaturan"
        actions={
          <Button icon="lock" onClick={lockOwner}>
            Kunci
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Rates settings={refs.settings} onSaved={refs.reload} />
        <Stores onChange={refs.reload} />
      </div>
      <div className="mt-4">
        <TeamCommissionCard raw={refs.settings.team_commission} onSaved={refs.reload} />
      </div>
      <div className="mt-4">
        <DataTools />
      </div>
    </>
  )
}

function Rates({ settings, onSaved }: { settings: Record<string, string>; onSaved: () => void }) {
  const [v, setV] = useState<Record<string, string>>({})
  const toast = useToast()
  useEffect(() => setV(settings), [settings])
  const show = (k: string, kind: string) => {
    const raw = v[k] ?? ''
    return kind === 'pct' && raw !== '' ? String(Math.round(parseFloat(raw) * 10000) / 100) : raw
  }
  const put = (k: string, kind: string, val: string) => setV({ ...v, [k]: kind === 'pct' && val !== '' ? String(parseFloat(val) / 100) : val })
  async function save() {
    await api.put('/settings', Object.fromEntries(FIELDS.map((f) => [f.key, v[f.key] ?? ''])))
    toast('Pengaturan disimpan')
    onSaved()
  }
  return (
    <Card title="Tarif & asumsi perhitungan" actions={<Button variant="primary" onClick={save}>Simpan</Button>}>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.key} label={`${f.label}${f.kind === 'pct' ? ' (%)' : f.kind === 'rp' ? ' (Rp)' : ''}`} hint={f.hint}>
            <Input type="number" step="any" value={show(f.key, f.kind)} onChange={(e) => put(f.key, f.kind, e.target.value)} />
          </Field>
        ))}
      </div>
    </Card>
  )
}

type MemberRow = { name: string; pct: string }
function TeamCommissionCard({ raw, onSaved }: { raw: string | undefined; onSaved: () => void }) {
  const [start, setStart] = useState('')
  const [rows, setRows] = useState<MemberRow[]>([])
  const toast = useToast()
  useEffect(() => {
    const t = parseTeamCommission(raw)
    setStart(t.start)
    setRows(t.members.map((m) => ({ name: m.name, pct: String(Math.round(m.pct * 10000) / 100) })))
  }, [raw])
  const upd = (i: number, patch: Partial<MemberRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const total = rows.reduce((a, r) => a + (parseFloat(r.pct) || 0), 0)
  async function save() {
    const members: TeamMember[] = rows
      .map((r) => ({ name: r.name.trim(), pct: (parseFloat(r.pct) || 0) / 100 }))
      .filter((m) => m.name && m.pct > 0)
    await api.put('/settings', { team_commission: JSON.stringify({ start, members }) })
    toast('Komisi tim disimpan')
    onSaved()
    window.dispatchEvent(new Event('g88:refresh'))
  }
  return (
    <Card
      title="Komisi tim per orang"
      subtitle="Persen dari pendapatan bersih bulanan (omzet − potongan TikTok)"
      actions={<Button variant="primary" onClick={save}>Simpan</Button>}
    >
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <Field label="Mulai dihitung otomatis" hint="Sebelum bulan ini, komisi dicatat manual di Biaya Operasional">
          <Input type="month" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <div className="flex flex-col gap-2">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_auto] items-end gap-2">
              <Field label={i === 0 ? 'Nama' : ''}>
                <Input value={r.name} onChange={(e) => upd(i, { name: e.target.value })} placeholder="Nama" />
              </Field>
              <Field label={i === 0 ? 'Komisi (%)' : ''}>
                <Input type="number" step="any" value={r.pct} onChange={(e) => upd(i, { pct: e.target.value })} />
              </Field>
              <IconButton icon="trash" label="Hapus orang" tone="danger" onClick={() => setRows(rows.filter((_, j) => j !== i))} />
            </div>
          ))}
          {!rows.length && <p className="text-[14px] text-muted">Belum ada anggota tim. Komisi tidak dihitung otomatis.</p>}
          <div className="mt-1 flex items-center justify-between">
            <Button icon="plus" onClick={() => setRows([...rows, { name: '', pct: '' }])}>
              Tambah orang
            </Button>
            <span className="text-[14px] text-ink-2">
              Total <span className="num font-semibold text-ink">{Math.round(total * 100) / 100}%</span>
            </span>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Stores({ onChange }: { onChange: () => void }) {
  const { data, reload } = useData<{ stores: Store[] }>('/settings')
  const [name, setName] = useState('')
  const [channel, setChannel] = useState('TikTok Shop')
  const toast = useToast()
  async function add() {
    try {
      await api.post('/stores', { name, channel })
      setName('')
      toast('Toko ditambahkan')
      reload()
      onChange()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function remove(s: Store) {
    if (!confirmDelete(`toko ${s.name} (data penjualannya tetap tersimpan)`)) return
    await api.del(`/stores/${s.id}`)
    reload()
    onChange()
  }
  return (
    <Card title="Toko & kanal penjualan">
      <div className="flex flex-col gap-2">
        {(data?.stores ?? []).map((s) => (
          <div key={s.id} className="flex items-center justify-between rounded-xl border border-line-soft px-4 py-2.5">
            <div>
              <div className="font-medium text-ink">{s.name}</div>
              <div className="text-[12.5px] text-muted">{s.channel}</div>
            </div>
            <IconButton icon="trash" label="Hapus toko" tone="danger" onClick={() => remove(s)} />
          </div>
        ))}
        {!data?.stores.length && <p className="text-[14px] text-muted">Belum ada toko.</p>}
      </div>
      <div className="mt-4 grid grid-cols-[1fr_150px_auto] items-end gap-2">
        <Field label="Nama toko">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Contoh: Glamora88.id" />
        </Field>
        <Field label="Kanal">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)} options={['TikTok Shop', 'Shopee', 'Instagram/WhatsApp', 'Offline', 'Lainnya']} />
        </Field>
        <Button icon="plus" onClick={add} disabled={!name.trim()}>
          Tambah
        </Button>
      </div>
    </Card>
  )
}

type Unmapped = { platform_sku_id: string; product_name: string; variation: string; store: string; lines: number; qty: number }
export function SkuMapping({ skuOptions }: { skuOptions: { value: string; label: string }[] }) {
  const { data, reload } = useData<{ map: unknown[]; unmapped: Unmapped[] }>('/sku-map')
  const [choice, setChoice] = useState<Record<string, string>>({})
  const toast = useToast()
  async function save(u: Unmapped) {
    await api.post('/sku-map', { platform_sku_id: u.platform_sku_id, sku: choice[u.platform_sku_id], product_name: u.product_name, variation: u.variation })
    toast('Pemetaan disimpan')
    reload()
    window.dispatchEvent(new Event('g88:refresh'))
  }
  return (
    <Card
      title="Pemetaan SKU TikTok"
      subtitle={`${int(data?.map.length ?? 0)} SKU terpetakan`}
      padded={false}
    >
      {!data?.unmapped.length ? (
        <div className="p-5">
          <Callout tone="good" title="Semua penjualan sudah terpetakan ke SKU" />
        </div>
      ) : (
        <Table
          head={
            <tr>
              <th className={th}>Produk di TikTok</th>
              <th className={`${th} text-right`}>Qty</th>
              <th className={`${th} w-[340px]`}>SKU internal</th>
              <th className={th}></th>
            </tr>
          }
        >
          {data.unmapped.map((u) => (
            <tr key={`${u.platform_sku_id}-${u.store}`}>
              <td className={td}>
                <div className="font-medium text-ink">{u.product_name}</div>
                <div className="text-[12.5px] text-muted">
                  {u.variation} · {u.store} · ID {u.platform_sku_id}
                </div>
              </td>
              <td className={tdNum}>{int(u.qty)}</td>
              <td className={td}>
                <Select
                  value={choice[u.platform_sku_id] ?? ''}
                  onChange={(e) => setChoice({ ...choice, [u.platform_sku_id]: e.target.value })}
                  options={[{ value: '', label: 'Pilih SKU…' }, ...skuOptions]}
                />
              </td>
              <td className={td}>
                <Button onClick={() => save(u)} disabled={!choice[u.platform_sku_id]}>
                  Simpan
                </Button>
              </td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}

function DataTools() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Record<string, number> | null>(null)
  async function importFile(f: File) {
    if (!window.confirm('Impor akan MENGGANTI data pada tabel yang ada di file ini. Lanjutkan? (Disarankan unduh cadangan dulu.)')) return
    setBusy(true)
    try {
      const json = JSON.parse(await f.text())
      const r = await api.post<{ counts: Record<string, number> }>('/data/import', json)
      setResult(r.counts)
      toast('Data berhasil diimpor')
      window.dispatchEvent(new Event('g88:refresh'))
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  const LABEL: Record<string, string> = {
    settings: 'pengaturan',
    stores: 'toko',
    products: 'produk',
    variants: 'varian',
    sku_map: 'pemetaan SKU',
    sales: 'baris penjualan',
    purchases: 'batch pembelian',
    purchase_items: 'isi batch',
    stock_adjustments: 'penyesuaian stok',
    boosts: 'boost',
    expenses: 'biaya',
    live_sessions: 'sesi live',
    settlements: 'baris settlement',
  }
  return (
    <Card title="Impor & cadangan data">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line-soft p-4">
          <div className="font-medium text-ink">Unduh cadangan</div>
          <a href="/api/data/export" className="mt-3 inline-block">
            <Button icon="download">Unduh cadangan</Button>
          </a>
        </div>
        <div className="rounded-xl border border-line-soft p-4">
          <div className="font-medium text-ink">Impor data</div>
          <label className="mt-3 inline-block">
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} disabled={busy} />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 btn-gold rounded-full border border-transparent px-4 text-[14px] font-semibold text-navy">
              {busy ? 'Mengimpor…' : 'Pilih file .json'}
            </span>
          </label>
        </div>
      </div>
      <ResetData />
      {result && (
        <div className="mt-4">
          <Callout tone="good" title="Impor selesai">
            {Object.entries(result)
              .map(([k, n]) => `${int(n)} ${LABEL[k] ?? k}`)
              .join(' · ')}
          </Callout>
        </div>
      )}
    </Card>
  )
}

function ResetData() {
  const toast = useToast()
  const [keepSetup, setKeepSetup] = useState(true)
  const [busy, setBusy] = useState(false)
  async function reset() {
    const what = keepSetup
      ? 'Semua penjualan, pencairan, pembelian, stok opname, boost, biaya, dan sesi live akan DIHAPUS. Pengaturan, toko, produk, dan pemetaan SKU tetap ada.'
      : 'SELURUH isi portal akan DIHAPUS, termasuk pengaturan, toko, produk, dan pemetaan SKU. Pengaturan kembali ke nilai bawaan.'
    const typed = window.prompt(`${what}\n\nData yang dihapus tidak bisa dikembalikan kecuali dari file cadangan. Unduh cadangan dulu bila perlu.\n\nKetik RESET untuk melanjutkan:`)
    if (typed === null) return
    if (typed.trim() !== 'RESET') {
      toast('Reset dibatalkan: ketik RESET dengan huruf besar', 'bad')
      return
    }
    setBusy(true)
    try {
      await api.post('/data/reset', { confirm: 'RESET', keepSetup })
      toast('Data sudah direset')
      window.dispatchEvent(new Event('g88:refresh'))
      setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="mt-4 rounded-xl border border-line-soft p-4">
      <div className="font-medium text-ink">Reset data</div>
      <p className="mt-1 text-[13.5px] text-ink-2">Mengosongkan portal untuk mulai input dari awal. Unduh cadangan dulu agar bisa dikembalikan lewat Impor data.</p>
      <label className="mt-3 flex items-start gap-3 text-[13.5px] text-ink-2">
        <input type="checkbox" className="mt-1 accent-[#1f2a44]" checked={keepSetup} onChange={(e) => setKeepSetup(e.target.checked)} />
        <span>Pertahankan pengaturan, toko, produk, dan pemetaan SKU</span>
      </label>
      <div className="mt-3">
        <Button variant="danger" icon="trash" onClick={reset} disabled={busy}>
          {busy ? 'Mereset…' : 'Reset data'}
        </Button>
      </div>
    </div>
  )
}
