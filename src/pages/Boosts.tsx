import { useMemo, useState } from 'react'
import type { Boost } from '../../shared/types'
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

const cost = (b: Pick<Boost, 'budget' | 'coupon' | 'apple_fee'>) => (Number(b.budget) || 0) - (Number(b.coupon) || 0) + (Number(b.apple_fee) || 0)

export default function Boosts() {
  const { data, error, reload } = useData<Boost[]>('/boosts')
  const refs = useRefs()
  const [form, setForm] = useState<Partial<Boost> | null>(null)
  const toast = useToast()
  const s = useMemo(() => {
    const rows = data ?? []
    const total = rows.reduce((a, b) => a + cost(b), 0)
    const apple = rows.reduce((a, b) => a + b.apple_fee, 0)
    const purchases = rows.reduce((a, b) => a + (b.purchases ?? 0), 0)
    const viewers = rows.reduce((a, b) => a + (b.viewers ?? 0), 0)
    return { total, apple, purchases, viewers, n: rows.length }
  }, [data])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />
  async function remove(b: Boost) {
    if (!confirmDelete('catatan boost ini')) return
    await api.del(`/boosts/${b.id}`)
    toast('Boost dihapus')
    reload()
  }
  return (
    <>
      <PageHeader
        title="Boost & Promosi"
        subtitle="Catat setiap promosi TikTok (LIVE atau video) beserta hasilnya, supaya terlihat promosi mana yang benar-benar mendatangkan pembeli."
        actions={
          <Button variant="primary" icon="plus" onClick={() => setForm({ boost_date: `${today()} 19:00:00`, kind: 'LIVE', store: refs.stores[0], budget: 0, coupon: 0, apple_fee: 0 })}>
            Catat boost
          </Button>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Total uang keluar" value={rp(s.total, { compact: true })} hint={`${int(s.n)} promosi`} />
        <Stat label="Habis untuk Apple fee" value={rp(s.apple, { compact: true })} hint={s.total ? `${pct(s.apple / s.total, 0)} dari total` : undefined} tone={s.total && s.apple / s.total > 0.15 ? 'bad' : 'neutral'} />
        <Stat label="Pembelian dari boost" value={int(s.purchases)} hint={s.purchases ? `${rp(s.total / s.purchases, { compact: true })} per pembelian` : 'Belum ada yang tercatat'} />
        <Stat label="Penonton LIVE dari boost" value={int(s.viewers)} hint={s.viewers ? `${rp(s.total / s.viewers)} per penonton` : undefined} />
      </div>
      {s.apple > 0 && s.total > 0 && s.apple / s.total > 0.15 && (
        <div className="mb-4">
          <Callout tone="warning" title="Apple service fee menggerus anggaran promosi">
            Koin promosi yang dibeli lewat aplikasi di iPhone dikenai biaya ±59% dari budget. Coba isi saldo lewat browser (TikTok Ads/Promote web) atau HP Android.
          </Callout>
        </div>
      )}
      <Card padded={false}>
        {!data.length ? (
          <div className="p-5">
            <Empty title="Belum ada catatan boost" />
          </div>
        ) : (
          <Table
            head={
              <tr>
                <th className={th}>Tanggal</th>
                <th className={th}>Promosi</th>
                <th className={`${th} text-right`}>Budget</th>
                <th className={`${th} text-right`}>Kupon</th>
                <th className={`${th} text-right`}>Apple fee</th>
                <th className={`${th} text-right`}>Uang keluar</th>
                <th className={th}>Hasil</th>
                <th className={th}></th>
              </tr>
            }
          >
            {data.map((b) => (
              <tr key={b.id}>
                <td className={`${td} whitespace-nowrap text-ink-2`}>{dateLabel(b.boost_date)}</td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <Badge tone={b.kind === 'LIVE' ? 'gold' : 'info'}>{b.kind}</Badge>
                    <span className="font-medium text-ink">{b.title || '(tanpa judul)'}</span>
                  </div>
                  <div className="mt-0.5 text-[12px] text-muted">
                    {b.store}
                    {b.status ? ` · ${b.status}` : ''}
                  </div>
                </td>
                <td className={tdNum}>{rp(b.budget)}</td>
                <td className={tdNum}>{b.coupon ? `−${rp(b.coupon)}` : '–'}</td>
                <td className={tdNum}>{b.apple_fee ? rp(b.apple_fee) : '–'}</td>
                <td className={`${tdNum} font-semibold`}>{rp(cost(b))}</td>
                <td className={`${td} text-[13px] text-ink-2`}>
                  {[b.purchases != null && `${b.purchases} pembelian`, b.viewers != null && `${int(b.viewers)} penonton`, b.views != null && `${int(b.views)} views`]
                    .filter(Boolean)
                    .join(' · ') || '–'}
                </td>
                <td className={`${td} whitespace-nowrap text-right`}>
                  <IconButton icon="edit" label="Ubah" onClick={() => setForm(b)} />
                  <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => remove(b)} />
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {form && <BoostForm initial={form} stores={refs.stores} onClose={() => setForm(null)} onSaved={reload} />}
    </>
  )
}

function BoostForm({ initial, stores, onClose, onSaved }: { initial: Partial<Boost>; stores: string[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState<Partial<Boost>>(initial)
  const toast = useToast()
  const set = (k: keyof Boost, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  const numOrNull = (s: string) => (s === '' ? null : Number(s))
  async function save() {
    try {
      if (v.id) await api.put(`/boosts/${v.id}`, v)
      else await api.post('/boosts', v)
      toast('Boost disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <Modal
      open
      title={v.id ? 'Ubah catatan boost' : 'Catat boost baru'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!v.boost_date || !v.store}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tanggal & jam">
          <Input
            type="datetime-local"
            value={(v.boost_date ?? '').slice(0, 16).replace(' ', 'T')}
            onChange={(e) => set('boost_date', `${e.target.value.replace('T', ' ')}:00`)}
          />
        </Field>
        <Field label="Toko">
          <Select value={v.store ?? ''} onChange={(e) => set('store', e.target.value)} options={[{ value: '', label: 'Pilih…' }, ...stores]} />
        </Field>
        <Field label="Jenis">
          <Select value={v.kind ?? 'LIVE'} onChange={(e) => set('kind', e.target.value)} options={['LIVE', 'Video']} />
        </Field>
        <Field label="Status">
          <Select value={v.status ?? 'Completed'} onChange={(e) => set('status', e.target.value)} options={['Completed', 'Closed', 'Not delivering', 'Berjalan']} />
        </Field>
        <Field label="Judul / materi" className="col-span-2">
          <Input value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} />
        </Field>
        <Field label="Total budget (Rp)">
          <Input type="number" value={v.budget ?? ''} onChange={(e) => set('budget', Number(e.target.value))} />
        </Field>
        <Field label="Kupon / diskon (Rp)">
          <Input type="number" value={v.coupon ?? ''} onChange={(e) => set('coupon', Number(e.target.value))} />
        </Field>
        <Field label="Apple service fee (Rp)" hint="Isi 0 jika bayar lewat web/Android">
          <Input type="number" value={v.apple_fee ?? ''} onChange={(e) => set('apple_fee', Number(e.target.value))} />
        </Field>
        <div className="flex flex-col justify-end rounded-xl bg-canvas px-4 py-2.5">
          <span className="text-[12.5px] text-muted">Uang keluar</span>
          <span className="num text-[18px] font-semibold text-ink">{rp(cost(v as Boost))}</span>
        </div>
        <Field label="Pembelian (dari laporan)">
          <Input type="number" value={v.purchases ?? ''} onChange={(e) => set('purchases', numOrNull(e.target.value))} />
        </Field>
        <Field label="Penonton LIVE">
          <Input type="number" value={v.viewers ?? ''} onChange={(e) => set('viewers', numOrNull(e.target.value))} />
        </Field>
        <Field label="Video views">
          <Input type="number" value={v.views ?? ''} onChange={(e) => set('views', numOrNull(e.target.value))} />
        </Field>
        <Field label="Catatan" className="col-span-2">
          <Textarea value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
