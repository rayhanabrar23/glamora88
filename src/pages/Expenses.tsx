import { useMemo, useState } from 'react'
import { CLASSIFICATIONS, EXPENSE_CATEGORIES, type Expense } from '../../shared/types'
import { api } from '../lib/api'
import { dateLabel, monthLabel, rp, today } from '../lib/format'
import { useData } from '../lib/useData'
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
  Table,
  td,
  tdNum,
  th,
  useToast,
} from '../components/ui'

const clsTone: Record<string, 'neutral' | 'gold' | 'info' | 'good'> = {
  Tetap: 'neutral',
  'Tetap (diskresioner)': 'gold',
  'Semi-variabel': 'info',
  Variabel: 'good',
}

export default function Expenses() {
  const { data, error, reload } = useData<Expense[]>('/expenses')
  const [form, setForm] = useState<Partial<Expense> | null>(null)
  const [month, setMonth] = useState('')
  const toast = useToast()
  const rows = useMemo(() => (data ?? []).filter((e) => !month || e.exp_date.startsWith(month)), [data, month])
  const byMonth = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const e of data ?? []) {
      const k = e.exp_date.slice(0, 7)
      const r = m.get(k) ?? {}
      const key = e.cash_only ? 'Kas saja' : e.classification
      r[key] = (r[key] ?? 0) + e.amount
      m.set(k, r)
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]))
  }, [data])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />
  async function remove(e: Expense) {
    if (!confirmDelete('biaya ini')) return
    await api.del(`/expenses/${e.id}`)
    toast('Biaya dihapus')
    reload()
  }
  return (
    <>
      <PageHeader
        title="Biaya Operasional"
        actions={
          <Button variant="primary" icon="plus" onClick={() => setForm({ exp_date: today(), category: 'Gaji', classification: 'Semi-variabel', cash_only: 0 })}>
            Catat biaya
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <Card
          className="min-w-0"
          padded={false}
          title="Daftar biaya"
          actions={
            <div className="w-[170px] shrink-0">
              <Input type="month" className="h-9" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Filter bulan" />
            </div>
          }
        >
          {!rows.length ? (
            <div className="p-5">
              <Empty title="Belum ada biaya" />
            </div>
          ) : (
            <Table
              head={
                <tr>
                  <th className={th}>Tanggal</th>
                  <th className={th}>Pos biaya</th>
                  <th className={th}>Klasifikasi</th>
                  <th className={`${th} text-right`}>Jumlah</th>
                  <th className={th}></th>
                </tr>
              }
              footer={
                <tr>
                  <td className={td} colSpan={3}>
                    Total
                  </td>
                  <td className={tdNum}>{rp(rows.reduce((a, e) => a + e.amount, 0))}</td>
                  <td></td>
                </tr>
              }
            >
              {rows.map((e) => (
                <tr key={e.id}>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>{dateLabel(e.exp_date)}</td>
                  <td className={td}>
                    <div className="font-medium text-ink">{e.category}</div>
                    {e.description && <div className="text-[12.5px] text-muted">{e.description}</div>}
                  </td>
                  <td className={td}>
                    <Badge tone={clsTone[e.classification] ?? 'neutral'}>{e.cash_only ? 'Kas (bukan beban)' : e.classification}</Badge>
                  </td>
                  <td className={`${tdNum} font-medium`}>{rp(e.amount)}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <IconButton icon="edit" label="Ubah" onClick={() => setForm(e)} />
                    <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => remove(e)} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
        <Card title="Rekap per bulan">
          <div className="flex flex-col gap-3">
            {byMonth.map(([m, r]) => {
              const total = Object.values(r).reduce((a, b) => a + b, 0)
              return (
                <div key={m} className="rounded-xl border border-line-soft px-4 py-3">
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium text-ink">{monthLabel(m, true)}</span>
                    <span className="num font-semibold text-ink">{rp(total)}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-ink-2">
                    {Object.entries(r).map(([k, v]) => (
                      <span key={k}>
                        {k}: <span className="num">{rp(v, { compact: true })}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
      {form && <ExpenseForm initial={form} onClose={() => setForm(null)} onSaved={reload} />}
    </>
  )
}

function ExpenseForm({ initial, onClose, onSaved }: { initial: Partial<Expense>; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState(initial)
  const toast = useToast()
  async function save() {
    try {
      if (v.id) await api.put(`/expenses/${v.id}`, v)
      else await api.post('/expenses', v)
      toast('Biaya disimpan')
      onSaved()
      onClose()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  return (
    <Modal
      open
      title={v.id ? 'Ubah biaya' : 'Catat biaya'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={save} disabled={!v.exp_date || !v.amount}>
            Simpan
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <Field label="Tanggal">
          <Input type="date" value={v.exp_date ?? ''} onChange={(e) => setV({ ...v, exp_date: e.target.value })} />
        </Field>
        <Field label="Jumlah (Rp)">
          <Input type="number" value={v.amount ?? ''} onChange={(e) => setV({ ...v, amount: Number(e.target.value) })} />
        </Field>
        <Field label="Pos biaya">
          <Select value={v.category ?? 'Gaji'} onChange={(e) => setV({ ...v, category: e.target.value })} options={[...EXPENSE_CATEGORIES]} />
        </Field>
        <Field label="Klasifikasi">
          <Select value={v.classification ?? 'Tetap'} onChange={(e) => setV({ ...v, classification: e.target.value as Expense['classification'] })} options={[...CLASSIFICATIONS]} />
        </Field>
        <Field label="Keterangan" className="col-span-2">
          <Input value={v.description ?? ''} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Contoh: Gaji pokok Ica (admin) Oktober" />
        </Field>
        <label className="col-span-2 flex items-start gap-3 rounded-xl bg-canvas px-4 py-3 text-[13.5px] text-ink-2">
          <input type="checkbox" className="mt-1 accent-[#1f2a44]" checked={!!v.cash_only} onChange={(e) => setV({ ...v, cash_only: e.target.checked ? 1 : 0 })} />
          <span>Hanya arus kas (uang muka, deposit, peralatan)</span>
        </label>
      </div>
    </Modal>
  )
}
