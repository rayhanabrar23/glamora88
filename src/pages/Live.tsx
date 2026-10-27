import { useMemo, useState } from 'react'
import type { LiveReport, LiveSession, SuggestedSession } from '../../shared/live'
import { api, qs } from '../lib/api'
import { dateLabel, int, pct, rp, today } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import { ModelBars } from '../components/charts'
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

const hhmm = (s: string) => s.slice(11, 16)
const durLabel = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} jam${m % 60 ? ` ${m % 60} mnt` : ''}` : `${m} mnt`)

export default function Live() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const { data, error, reload } = useData<LiveReport>(`/live${qs({ from, to })}`)
  const refs = useRefs()
  const [form, setForm] = useState<Partial<LiveSession> | null>(null)
  const toast = useToast()
  const hosts = useMemo(() => [...new Set((data?.sessions ?? []).map((s) => s.host).filter(Boolean) as string[])], [data])

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />
  const t = data.totals
  async function remove(s: LiveSession) {
    if (!confirmDelete(`sesi live ${dateLabel(s.start_at)}`)) return
    await api.del(`/live/${s.id}`)
    toast('Sesi dihapus')
    reload()
  }
  return (
    <>
      <PageHeader
        title="Sesi Live"
        subtitle="Catat setiap sesi live. Penjualan yang masuk selama sesi (hingga 15 menit setelahnya) otomatis dihitung sebagai hasil sesi tersebut."
        actions={
          <>
            <label className="text-[12px] text-muted">
              Dari
              <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-[150px]" />
            </label>
            <label className="text-[12px] text-muted">
              Sampai
              <Input type="month" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-[150px]" />
            </label>
            <Button
              variant="primary"
              icon="plus"
              className="self-end"
              onClick={() => setForm({ start_at: `${today()} 19:00:00`, duration_min: 120, store: refs.stores[0] })}
            >
              Catat sesi
            </Button>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Sesi live" value={int(t.sessions)} hint={`${int(t.daysWithLive)} hari live dari ${int(t.daysInRange)} hari`} />
        <Stat label="Total jam live" value={`${t.hours.toLocaleString('id-ID', { maximumFractionDigits: 1 })} jam`} />
        <Stat label="Omzet dari live" value={rp(t.omzet, { compact: true })} hint={`${pct(t.liveShare, 0)} dari omzet neto · ${int(t.pcs)} pcs`} />
        <Stat label="Omzet per jam live" value={rp(t.hours ? t.omzet / t.hours : 0, { compact: true })} hint={t.hours ? `${(t.pcs / t.hours).toLocaleString('id-ID', { maximumFractionDigits: 1 })} pcs per jam` : undefined} />
      </div>

      {data.suggestions.length > 0 && <Suggestions items={data.suggestions} hosts={hosts} onAdded={reload} />}

      {data.sessions.length > 0 && (
        <>
          <div className="mt-4">
            <Card title="Kinerja per host" subtitle="Diurutkan dari omzet per jam tertinggi" padded={false}>
              <Table
                head={
                  <tr>
                    <th className={th}>Host</th>
                    <th className={`${th} text-right`}>Sesi</th>
                    <th className={`${th} text-right`}>Jam live</th>
                    <th className={`${th} text-right`}>Pcs</th>
                    <th className={`${th} text-right`}>Omzet</th>
                    <th className={`${th} text-right`}>Pcs / jam</th>
                    <th className={`${th} text-right`}>Omzet / jam</th>
                    <th className={`${th} text-right`}>Sesi tanpa penjualan</th>
                  </tr>
                }
              >
                {data.hosts.map((h) => (
                  <tr key={h.host}>
                    <td className={`${td} font-medium text-ink`}>{h.host}</td>
                    <td className={tdNum}>{int(h.sessions)}</td>
                    <td className={tdNum}>{h.hours.toLocaleString('id-ID', { maximumFractionDigits: 1 })}</td>
                    <td className={tdNum}>{int(h.pcs)}</td>
                    <td className={tdNum}>{rp(h.omzet, { compact: true })}</td>
                    <td className={tdNum}>{h.pcsPerHour.toLocaleString('id-ID', { maximumFractionDigits: 1 })}</td>
                    <td className={`${tdNum} font-semibold`}>{rp(h.omzetPerHour, { compact: true })}</td>
                    <td className={tdNum}>{h.zeroSessions ? <Badge tone="warn">{h.zeroSessions}</Badge> : '–'}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Hari terbaik untuk live" subtitle="Omzet per jam live, menurut hari">
              <ModelBars
                data={data.byWeekday.map((b) => ({
                  label: b.label,
                  value: b.omzetPerHour,
                  sub: b.sessions ? `${rp(b.omzetPerHour, { compact: true })}/jam · ${b.sessions} sesi` : 'belum ada sesi',
                }))}
              />
            </Card>
            <Card title="Waktu terbaik untuk live" subtitle="Omzet per jam live, menurut jam mulai">
              <ModelBars
                data={data.byHour.map((b) => ({
                  label: b.label,
                  value: b.omzetPerHour,
                  sub: b.sessions ? `${rp(b.omzetPerHour, { compact: true })}/jam · ${b.sessions} sesi` : 'belum ada sesi',
                }))}
              />
            </Card>
          </div>
        </>
      )}

      <div className="mt-4">
        <Card title="Daftar sesi" padded={false}>
          {!data.sessions.length ? (
            <div className="p-5">
              <Empty title="Belum ada sesi live tercatat">Catat sesi baru, atau tambahkan usulan sesi dari pola order di atas.</Empty>
            </div>
          ) : (
            <Table
              head={
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Waktu</th>
                  <th className={th}>Toko · host</th>
                  <th className={`${th} text-right`}>Pesanan</th>
                  <th className={`${th} text-right`}>Pcs</th>
                  <th className={`${th} text-right`}>Omzet</th>
                  <th className={`${th} text-right`}>Omzet / jam</th>
                  <th className={th}></th>
                </tr>
              }
            >
              {data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className={`${td} whitespace-nowrap`}>{dateLabel(s.start_at.slice(0, 10))}</td>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>
                    {hhmm(s.start_at)}–{hhmm(s.end_at)} <span className="text-muted">· {durLabel(s.duration_min)}</span>
                  </td>
                  <td className={td}>
                    <div className="font-medium text-ink">{s.host || <span className="text-muted">Host belum diisi</span>}</div>
                    <div className="text-[12px] text-muted">
                      {s.store}
                      {s.title ? ` · ${s.title}` : ''}
                      {s.viewers != null ? ` · ${int(s.viewers)} penonton` : ''}
                    </div>
                  </td>
                  <td className={tdNum}>{int(s.orders)}</td>
                  <td className={tdNum}>{int(s.pcs)}</td>
                  <td className={`${tdNum} font-medium`}>{rp(s.omzet)}</td>
                  <td className={tdNum}>{s.pcs ? rp(s.omzetPerHour, { compact: true }) : <Badge tone="warn">Tanpa penjualan</Badge>}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <IconButton icon="edit" label="Ubah" onClick={() => setForm(s)} />
                    <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => remove(s)} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>
      {form && <SessionForm initial={form} stores={refs.stores} hosts={hosts} onClose={() => setForm(null)} onSaved={reload} />}
    </>
  )
}

function Suggestions({ items, hosts, onAdded }: { items: SuggestedSession[]; hosts: string[]; onAdded: () => void }) {
  const [picked, setPicked] = useState<Record<number, boolean>>({})
  const [host, setHost] = useState('')
  const [open, setOpen] = useState(false)
  const toast = useToast()
  const chosen = items.filter((_, i) => picked[i])
  const total = items.reduce((a, s) => a + s.omzet, 0)
  async function add() {
    await api.post(
      '/live',
      chosen.map((s) => ({ start_at: s.start_at, duration_min: s.duration_min, store: s.store, host: host || null, notes: 'Dari deteksi otomatis pola order' })),
    )
    toast(`${chosen.length} sesi ditambahkan`)
    setPicked({})
    onAdded()
  }
  return (
    <Card
      title={`${items.length} kemungkinan sesi live belum tercatat`}
      subtitle={`Terdeteksi dari order yang berdekatan (≥3 pesanan, jeda ≤45 menit) · total ${rp(total, { compact: true })}`}
      actions={<Button onClick={() => setOpen(!open)}>{open ? 'Tutup' : 'Lihat & tambahkan'}</Button>}
      padded={open ? false : true}
    >
      {!open ? (
        <Callout tone="info" title="Isi riwayat live dengan cepat">
          Pilih sesi yang memang live, isi nama host-nya, lalu tambahkan. Jam mulai & durasi bisa disesuaikan setelahnya.
        </Callout>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 border-b border-line-soft px-5 py-4">
            <Field label="Host untuk sesi terpilih">
              <Input list="hosts-list" className="h-9 w-[220px]" value={host} onChange={(e) => setHost(e.target.value)} placeholder="Opsional" />
            </Field>
            <datalist id="hosts-list">
              {hosts.map((h) => (
                <option key={h} value={h} />
              ))}
            </datalist>
            <Button onClick={() => setPicked(Object.fromEntries(items.map((_, i) => [i, true])))}>Pilih semua</Button>
            <Button variant="primary" icon="plus" disabled={!chosen.length} onClick={add}>
              Tambahkan {chosen.length || ''} sesi
            </Button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            <Table
              head={
                <tr>
                  <th className={`${th} w-10`}></th>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Perkiraan waktu</th>
                  <th className={th}>Toko</th>
                  <th className={`${th} text-right`}>Pesanan</th>
                  <th className={`${th} text-right`}>Omzet</th>
                </tr>
              }
            >
              {items.map((s, i) => (
                <tr key={`${s.store}${s.start_at}`} className="cursor-pointer" onClick={() => setPicked({ ...picked, [i]: !picked[i] })}>
                  <td className={td}>
                    <input type="checkbox" readOnly checked={!!picked[i]} className="accent-[#1f2a44]" />
                  </td>
                  <td className={`${td} whitespace-nowrap`}>{dateLabel(s.start_at.slice(0, 10))}</td>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>
                    {hhmm(s.start_at)} · {durLabel(s.duration_min)}
                  </td>
                  <td className={td}>{s.store}</td>
                  <td className={tdNum}>{int(s.orders)}</td>
                  <td className={tdNum}>{rp(s.omzet, { compact: true })}</td>
                </tr>
              ))}
            </Table>
          </div>
        </>
      )}
    </Card>
  )
}

function SessionForm({ initial, stores, hosts, onClose, onSaved }: { initial: Partial<LiveSession>; stores: string[]; hosts: string[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial)
  const toast = useToast()
  const set = (k: keyof LiveSession, val: unknown) => setV((x) => ({ ...x, [k]: val }))
  async function save() {
    try {
      if (v.id) await api.put(`/live/${v.id}`, v)
      else await api.post('/live', v)
      toast('Sesi disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <Modal
      open
      title={v.id ? 'Ubah sesi live' : 'Catat sesi live'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!v.start_at || !v.store || !v.duration_min}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Mulai live">
          <Input type="datetime-local" value={(v.start_at ?? '').slice(0, 16).replace(' ', 'T')} onChange={(e) => set('start_at', `${e.target.value.replace('T', ' ')}:00`)} />
        </Field>
        <Field label="Durasi (menit)">
          <Input type="number" min={5} step={5} value={v.duration_min ?? ''} onChange={(e) => set('duration_min', Number(e.target.value))} />
        </Field>
        <Field label="Toko">
          <Select value={v.store ?? ''} onChange={(e) => set('store', e.target.value)} options={[{ value: '', label: 'Pilih…' }, ...stores]} />
        </Field>
        <Field label="Host">
          <Input list="hosts-form" value={v.host ?? ''} onChange={(e) => set('host', e.target.value)} placeholder="Nama host" />
          <datalist id="hosts-form">
            {hosts.map((h) => (
              <option key={h} value={h} />
            ))}
          </datalist>
        </Field>
        <Field label="Judul / tema live" className="col-span-2">
          <Input value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Contoh: Promo gajian, serba 150 rb" />
        </Field>
        <Field label="Penonton (dari laporan LIVE)">
          <Input type="number" value={v.viewers ?? ''} onChange={(e) => set('viewers', e.target.value === '' ? null : Number(e.target.value))} />
        </Field>
        <div />
        <Field label="Catatan" className="col-span-2">
          <Textarea value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  )
}
