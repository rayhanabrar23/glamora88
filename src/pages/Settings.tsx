import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { int } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import { Button, Callout, Card, confirmDelete, Empty, Field, IconButton, Input, PageHeader, Select, Table, td, tdNum, th, useToast } from '../components/ui'
import type { Store } from '../../shared/types'

const FIELDS: { key: string; label: string; hint: string; kind: 'pct' | 'rp' | 'num' }[] = [
  { key: 'platform_commission_pct', label: 'Komisi platform', hint: 'Persen dari harga jual', kind: 'pct' },
  { key: 'dynamic_commission_pct', label: 'Komisi dinamis', hint: 'Persen dari harga jual', kind: 'pct' },
  { key: 'order_processing_fee', label: 'Biaya pemrosesan per pesanan', hint: 'Rupiah per pesanan', kind: 'rp' },
  { key: 'heavy_parcel_fee', label: 'Fee pengiriman paket berat', hint: 'Rupiah per pesanan di atas batas berat', kind: 'rp' },
  { key: 'heavy_parcel_threshold_kg', label: 'Batas berat paket (kg)', hint: 'Default 0,3 kg', kind: 'num' },
  { key: 'heavy_parcel_share_fallback', label: 'Porsi paket berat (cadangan)', hint: 'Dipakai jika berat tidak ada di data (input manual)', kind: 'pct' },
  { key: 'live_attribution_buffer_min', label: 'Toleransi penjualan setelah live (menit)', hint: 'Order yang masuk sampai sekian menit setelah live selesai tetap dihitung hasil live', kind: 'num' },
  { key: 'fallback_landed_cost', label: 'Landed cost cadangan', hint: 'Untuk SKU yang harga belinya belum dicatat', kind: 'rp' },
  { key: 'planned_fixed_cost', label: 'Rencana biaya tetap per bulan', hint: 'Untuk menghitung titik impas rencana (mis. setelah ruko dipakai). Kosongkan jika tidak ada', kind: 'rp' },
]

export default function Settings() {
  const refs = useRefs()
  return (
    <>
      <PageHeader title="Pengaturan" subtitle="Toko, tarif potongan TikTok, pemetaan SKU, serta impor & cadangan data." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Rates settings={refs.settings} onSaved={refs.reload} />
        <Stores onChange={refs.reload} />
      </div>
      <div className="mt-4">
        <SkuMapping skuOptions={refs.skuOptions} />
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
    <Card title="Tarif & asumsi perhitungan" subtitle="Ubah bila TikTok mengubah tarifnya" actions={<Button variant="primary" onClick={save}>Simpan</Button>}>
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
    <Card title="Toko & kanal penjualan" subtitle="Dipakai saat unggah export dan input manual">
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
function SkuMapping({ skuOptions }: { skuOptions: { value: string; label: string }[] }) {
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
      subtitle={`Hubungkan produk di file export TikTok dengan SKU internal. ${int(data?.map.length ?? 0)} SKU TikTok sudah terpetakan.`}
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
  }
  return (
    <Card title="Impor & cadangan data" subtitle="Simpan cadangan secara rutin, misalnya setiap akhir bulan">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-line-soft p-4">
          <div className="font-medium text-ink">Unduh cadangan</div>
          <p className="mt-1 text-[13.5px] text-muted">Semua data dalam satu file .json. Simpan di tempat aman, jangan diunggah ke repo publik.</p>
          <a href="/api/data/export" className="mt-3 inline-block">
            <Button icon="download">Unduh cadangan</Button>
          </a>
        </div>
        <div className="rounded-xl border border-line-soft p-4">
          <div className="font-medium text-ink">Impor data</div>
          <p className="mt-1 text-[13.5px] text-muted">Untuk memuat data awal atau memulihkan cadangan. Data di tabel yang sama akan diganti.</p>
          <label className="mt-3 inline-block">
            <input type="file" accept=".json" className="hidden" onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} disabled={busy} />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-xl border border-navy bg-navy px-3.5 text-[14px] font-medium text-white hover:bg-navy-2">
              {busy ? 'Mengimpor…' : 'Pilih file .json'}
            </span>
          </label>
        </div>
      </div>
      {result && (
        <div className="mt-4">
          <Callout tone="good" title="Impor selesai">
            {Object.entries(result)
              .map(([k, n]) => `${int(n)} ${LABEL[k] ?? k}`)
              .join(' · ')}
          </Callout>
        </div>
      )}
      {!result && <Empty title="Tips">Setelah impor data awal, cek menu Ringkasan dan cocokkan angkanya dengan rekap Excel.</Empty>}
    </Card>
  )
}
