import { useMemo, useState } from 'react'
import { AGENDA_CATEGORIES, expandAgenda, isForPerson, REPEAT_LABEL, type AgendaItem, type AgendaOccurrence, type AgendaRepeat } from '../../shared/agenda'
import { api } from '../lib/api'
import { useMe } from '../lib/me'
import { useData } from '../lib/useData'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, confirmDelete, Empty, ErrorBox, Field, IconButton, Input, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui'

type Data = { items: AgendaItem[]; people: string[] }
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const todayIso = () => iso(new Date())
const addDays = (s: string, n: number) => {
  const d = new Date(`${s}T00:00:00`)
  d.setDate(d.getDate() + n)
  return iso(d)
}
const dayLabel = (s: string, opts: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' }) => new Date(`${s}T00:00:00`).toLocaleDateString('id-ID', opts)
const CAT_TONE: Record<string, 'info' | 'gold' | 'good' | 'warn' | 'neutral' | 'bad'> = {
  Live: 'bad',
  'Restock & impor': 'gold',
  'Admin & data': 'info',
  Keuangan: 'good',
  'Konten & promo': 'warn',
  Rapat: 'neutral',
}
const CAT_DOT: Record<string, string> = { Live: 'bg-bad', 'Restock & impor': 'bg-gold', 'Admin & data': 'bg-navy', Keuangan: 'bg-good', 'Konten & promo': 'bg-warn', Rapat: 'bg-ink-2' }

export default function Agenda() {
  const { data, error, reload } = useData<Data>('/agenda')
  const { user } = useMe()
  const [view, setView] = useState<'daftar' | 'kalender'>('daftar')
  const [who, setWho] = useState('')
  const [cat, setCat] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [form, setForm] = useState<Partial<AgendaItem> | null>(null)
  const toast = useToast()
  const items = useMemo(() => (data?.items ?? []).filter((it) => (who === '' ? true : isForPerson(it, who)) && (!cat || it.category === cat)), [data, who, cat])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />

  async function toggle(o: AgendaOccurrence) {
    await api.post(`/agenda/${o.item.id}/done`, { date: o.date, done: !o.done })
    toast(o.done ? 'Ditandai belum selesai' : 'Ditandai selesai')
    reload()
    window.dispatchEvent(new Event('g88:agenda'))
  }
  const newItem = (date = todayIso()): Partial<AgendaItem> => ({ kind: 'kegiatan', start_date: date, repeat: 'none', category: 'Lainnya' })
  const people = data.people
  const meName = user && user.id > 0 ? user.name : ''

  return (
    <>
      <PageHeader
        title="Agenda Tim"
        actions={
          <>
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: 'daftar', label: 'Daftar' },
                { value: 'kalender', label: 'Kalender' },
              ]}
            />
            <Button variant="primary" icon="plus" onClick={() => setForm(newItem())}>
              Tambah agenda
            </Button>
          </>
        }
      />
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Untuk" className="w-full sm:w-[200px]">
            <Select
              value={who}
              onChange={(e) => setWho(e.target.value)}
              options={[{ value: '', label: 'Semua orang' }, ...(meName ? [{ value: meName, label: `Saya (${meName})` }] : []), ...people.filter((p) => p !== meName)]}
            />
          </Field>
          <Field label="Kategori" className="w-full sm:w-[200px]">
            <Select value={cat} onChange={(e) => setCat(e.target.value)} options={[{ value: '', label: 'Semua kategori' }, ...AGENDA_CATEGORIES]} />
          </Field>
          <label className="flex h-10 items-center gap-2 text-[13.5px] text-ink-2">
            <input type="checkbox" className="accent-[#1f2a44]" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            Tampilkan yang sudah selesai
          </label>
        </div>
      </Card>
      <div className="mt-4">
        {view === 'daftar' ? (
          <ListView items={items} showDone={showDone} onToggle={toggle} onEdit={setForm} onAdd={() => setForm(newItem())} />
        ) : (
          <CalendarView items={items} showDone={showDone} onToggle={toggle} onEdit={setForm} onAdd={(d) => setForm(newItem(d))} />
        )}
      </div>
      {form && <AgendaForm initial={form} people={people} onClose={() => setForm(null)} onSaved={() => (reload(), window.dispatchEvent(new Event('g88:agenda')))} />}
    </>
  )
}

function Row({ o, onToggle, onEdit, showDate }: { o: AgendaOccurrence; onToggle: (o: AgendaOccurrence) => void; onEdit: (it: AgendaItem) => void; showDate?: boolean }) {
  const it = o.item
  const late = !o.done && it.kind === 'pengingat' && o.date < todayIso()
  return (
    <div className="flex items-start gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-canvas/70">
      <input type="checkbox" aria-label={`Tandai selesai: ${it.title}`} className="mt-1 h-4 w-4 shrink-0 accent-[#1f2a44]" checked={o.done} onChange={() => onToggle(o)} />
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(it)}>
        <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${o.done ? 'text-muted line-through' : 'text-ink'}`}>
          <span className="text-[14.5px] font-medium">{it.title}</span>
          {it.kind === 'pengingat' && (
            <span className="inline-flex items-center gap-1 text-[12px] font-medium text-gold no-underline">
              <Icon name="bell" size={12} /> Pengingat
            </span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
          {showDate && <span className={late ? 'font-medium text-bad' : ''}>{dayLabel(o.date, { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
          <span className="inline-flex items-center gap-1">
            <Icon name="clock" size={12} />
            {it.start_time ?? 'Sepanjang hari'}
            {it.end_date && it.end_date !== it.start_date ? ` · s.d. ${dayLabel(it.end_date, { day: 'numeric', month: 'short' })}` : ''}
          </span>
          <span className="inline-flex items-center gap-1">
            <Icon name="users" size={12} />
            {it.assignee ?? 'Semua'}
          </span>
          {it.repeat !== 'none' && (
            <span className="inline-flex items-center gap-1">
              <Icon name="repeat" size={12} />
              {REPEAT_LABEL[it.repeat]}
            </span>
          )}
        </div>
        {it.notes && <div className="mt-1 line-clamp-2 text-[12.5px] text-ink-2">{it.notes}</div>}
      </button>
      {it.category && (
        <span className="hidden shrink-0 sm:block">
          <Badge tone={CAT_TONE[it.category] ?? 'neutral'}>{it.category}</Badge>
        </span>
      )}
    </div>
  )
}

function ListView({ items, showDone, onToggle, onEdit, onAdd }: { items: AgendaItem[]; showDone: boolean; onToggle: (o: AgendaOccurrence) => void; onEdit: (it: AgendaItem) => void; onAdd: () => void }) {
  const today = todayIso()
  const overdue = expandAgenda(items, addDays(today, -60), addDays(today, -1)).filter((o) => o.item.kind === 'pengingat' && !o.done)
  const upcoming = expandAgenda(items, today, addDays(today, 30)).filter((o) => showDone || !o.done)
  const byDate = new Map<string, AgendaOccurrence[]>()
  for (const o of upcoming) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])
  return (
    <div className="flex flex-col gap-4">
      {overdue.length > 0 && (
        <Card title={`Pengingat terlewat (${overdue.length})`}>
          <div className="-mx-3 flex flex-col">
            {overdue.map((o) => (
              <Row key={`${o.item.id}-${o.date}`} o={o} onToggle={onToggle} onEdit={onEdit} showDate />
            ))}
          </div>
        </Card>
      )}
      <Card title="30 hari ke depan">
        {!byDate.size ? (
          <Empty title="Belum ada agenda">
            <Button icon="plus" onClick={onAdd}>
              Tambah agenda
            </Button>
          </Empty>
        ) : (
          <div className="flex flex-col gap-4">
            {[...byDate.entries()].map(([d, os]) => (
              <div key={d} className="grid gap-1 sm:grid-cols-[150px_1fr] sm:gap-4">
                <div className="pt-2.5">
                  <div className={`text-[13.5px] font-semibold ${d === today ? 'text-gold' : 'text-ink'}`}>{d === today ? 'Hari ini' : d === addDays(today, 1) ? 'Besok' : dayLabel(d, { weekday: 'long' })}</div>
                  <div className="text-[12.5px] text-muted">{dayLabel(d, { day: 'numeric', month: 'long' })}</div>
                </div>
                <div className="-mx-3 flex flex-col border-line-soft sm:border-l sm:pl-1">
                  {os.map((o) => (
                    <Row key={`${o.item.id}-${o.date}`} o={o} onToggle={onToggle} onEdit={onEdit} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

const WEEK = ['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']
function CalendarView({ items, showDone, onToggle, onEdit, onAdd }: { items: AgendaItem[]; showDone: boolean; onToggle: (o: AgendaOccurrence) => void; onEdit: (it: AgendaItem) => void; onAdd: (date: string) => void }) {
  const today = todayIso()
  const [ym, setYm] = useState(today.slice(0, 7))
  const [sel, setSel] = useState(today)
  const [y, m] = ym.split('-').map(Number)
  const first = new Date(y, m - 1, 1)
  const lead = (first.getDay() + 6) % 7 // Senin = 0
  const days = new Date(y, m, 0).getDate()
  const start = addDays(iso(first), -lead)
  const cells = Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, i) => addDays(start, i))
  const occ = expandAgenda(items, cells[0], cells[cells.length - 1]).filter((o) => showDone || !o.done)
  const byDate = new Map<string, AgendaOccurrence[]>()
  for (const o of occ) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])
  const shift = (n: number) => {
    const d = new Date(y, m - 1 + n, 1)
    setYm(`${d.getFullYear()}-${pad(d.getMonth() + 1)}`)
  }
  const selList = byDate.get(sel) ?? []
  return (
    <div className="grid gap-4 xl:grid-cols-[1.6fr_1fr]">
      <Card
        title={first.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })}
        actions={
          <div className="flex items-center gap-1">
            <IconButton icon="left" label="Bulan sebelumnya" onClick={() => shift(-1)} />
            <Button
              onClick={() => {
                setYm(today.slice(0, 7))
                setSel(today)
              }}
            >
              Hari ini
            </Button>
            <IconButton icon="right" label="Bulan berikutnya" onClick={() => shift(1)} />
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-center text-[12px] font-medium text-muted">
          {WEEK.map((w) => (
            <div key={w} className="py-1">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {cells.map((d) => {
            const os = byDate.get(d) ?? []
            const inMonth = d.slice(0, 7) === ym
            return (
              <button
                key={d}
                type="button"
                onClick={() => setSel(d)}
                className={`flex min-h-[64px] flex-col items-stretch rounded-xl border p-1.5 text-left transition-colors sm:min-h-[92px] ${sel === d ? 'border-gold bg-gold-soft/50' : 'border-line-soft hover:bg-canvas'} ${inMonth ? '' : 'opacity-45'}`}
              >
                <span className={`num mb-1 inline-flex h-6 w-6 items-center justify-center self-start rounded-full text-[12.5px] ${d === today ? 'bg-navy font-semibold text-white' : 'text-ink'}`}>{Number(d.slice(8))}</span>
                <span className="flex flex-wrap gap-1 sm:hidden">
                  {os.slice(0, 4).map((o) => (
                    <span key={`${o.item.id}-${o.date}`} className={`h-1.5 w-1.5 rounded-full ${CAT_DOT[o.item.category ?? ''] ?? 'bg-muted'}`} />
                  ))}
                </span>
                <span className="hidden flex-col gap-0.5 sm:flex">
                  {os.slice(0, 3).map((o) => (
                    <span key={`${o.item.id}-${o.date}`} className={`flex items-center gap-1 truncate text-[11.5px] ${o.done ? 'text-muted line-through' : 'text-ink-2'}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${CAT_DOT[o.item.category ?? ''] ?? 'bg-muted'}`} />
                      <span className="truncate">{o.item.title}</span>
                    </span>
                  ))}
                  {os.length > 3 && <span className="text-[11px] text-muted">+{os.length - 3} lagi</span>}
                </span>
              </button>
            )
          })}
        </div>
      </Card>
      <Card
        title={sel === today ? 'Hari ini' : dayLabel(sel, { weekday: 'long' })}
        subtitle={dayLabel(sel, { day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <Button icon="plus" onClick={() => onAdd(sel)}>
            Tambah
          </Button>
        }
      >
        {selList.length ? (
          <div className="-mx-3 flex flex-col">
            {selList.map((o) => (
              <Row key={`${o.item.id}-${o.date}`} o={o} onToggle={onToggle} onEdit={onEdit} />
            ))}
          </div>
        ) : (
          <p className="text-[13.5px] text-muted">Tidak ada agenda di tanggal ini.</p>
        )}
      </Card>
    </div>
  )
}

function AgendaForm({ initial, people, onClose, onSaved }: { initial: Partial<AgendaItem>; people: string[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const set = <K extends keyof AgendaItem>(k: K, val: AgendaItem[K] | null | undefined) => setV((x) => ({ ...x, [k]: val }))
  async function save() {
    setBusy(true)
    try {
      if (v.id) await api.put(`/agenda/${v.id}`, v)
      else await api.post('/agenda', v)
      toast('Agenda disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(false)
    }
  }
  async function remove() {
    if (!v.id || !confirmDelete(`agenda “${v.title}”${v.repeat !== 'none' ? ' beserta semua pengulangannya' : ''}`)) return
    await api.del(`/agenda/${v.id}`)
    toast('Agenda dihapus')
    onSaved()
    onClose()
  }
  return (
    <Modal
      open
      title={v.id ? 'Ubah agenda' : 'Tambah agenda'}
      onClose={onClose}
      footer={
        <>
          {v.id && (
            <Button variant="danger" icon="trash" onClick={remove} className="mr-auto">
              Hapus
            </Button>
          )}
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={busy || !v.title?.trim() || !v.start_date}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
        <Field label="Judul" className="sm:col-span-2">
          <Input autoFocus value={v.title ?? ''} onChange={(e) => set('title', e.target.value)} placeholder="Contoh: Live promo gajian, bayar batch 6, rapat bulanan" />
        </Field>
        <Field label="Jenis">
          <Select
            value={v.kind ?? 'kegiatan'}
            onChange={(e) => set('kind', e.target.value as AgendaItem['kind'])}
            options={[
              { value: 'kegiatan', label: 'Kegiatan' },
              { value: 'pengingat', label: 'Pengingat' },
            ]}
          />
        </Field>
        <Field label="Kategori">
          <Select value={v.category ?? 'Lainnya'} onChange={(e) => set('category', e.target.value)} options={AGENDA_CATEGORIES} />
        </Field>
        <Field label="Tanggal">
          <Input type="date" value={v.start_date ?? ''} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="Jam">
          <Input type="time" value={v.start_time ?? ''} onChange={(e) => set('start_time', e.target.value || null)} />
        </Field>
        <Field label="Untuk">
          <Select value={v.assignee ?? ''} onChange={(e) => set('assignee', e.target.value || null)} options={[{ value: '', label: 'Semua orang' }, ...people]} />
        </Field>
        {v.kind !== 'pengingat' && v.repeat === 'none' ? (
          <Field label="Sampai tanggal">
            <Input type="date" min={v.start_date} value={v.end_date ?? ''} onChange={(e) => set('end_date', e.target.value || null)} />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Ulangi">
          <Select
            value={v.repeat ?? 'none'}
            onChange={(e) => setV((x) => ({ ...x, repeat: e.target.value as AgendaRepeat, end_date: e.target.value === 'none' ? x.end_date : null }))}
            options={(Object.keys(REPEAT_LABEL) as AgendaRepeat[]).map((k) => ({ value: k, label: REPEAT_LABEL[k] }))}
          />
        </Field>
        {v.repeat && v.repeat !== 'none' ? (
          <Field label="Ulangi sampai">
            <Input type="date" min={v.start_date} value={v.repeat_until ?? ''} onChange={(e) => set('repeat_until', e.target.value || null)} />
          </Field>
        ) : (
          <div className="hidden sm:block" />
        )}
        <Field label="Catatan" className="sm:col-span-2">
          <Textarea value={v.notes ?? ''} onChange={(e) => set('notes', e.target.value)} placeholder="Detail, link, atau checklist singkat" />
        </Field>
        {v.created_by && <p className="text-[12px] text-muted sm:col-span-2">Dibuat oleh {v.created_by}</p>}
      </div>
    </Modal>
  )
}
