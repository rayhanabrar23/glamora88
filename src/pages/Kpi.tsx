import { useEffect, useMemo, useState } from 'react'
import { computeKpi, DEFAULT_KPI_CONFIG, METRICS, type KpiConfig, type KpiContext, type KpiDef, type KpiLine, type KpiMetric, type KpiMonthRecord, type KpiStaff, type KpiStaffResult, type KpiType } from '../../shared/kpi'
import { api } from '../lib/api'
import { int, monthLabel, rp, thisMonth } from '../lib/format'
import { useData } from '../lib/useData'
import { lockOwner, OwnerGate } from '../components/OwnerGate'
import { Badge, Button, Callout, Card, ErrorBox, Field, IconButton, Input, Loading, PageHeader, Select, Tabs, Textarea, useToast } from '../components/ui'

interface KpiResponse {
  month: string
  config: KpiConfig
  record: KpiMonthRecord
  ctx: KpiContext
  storeTargetDefault: number | null
  members: string[]
  trend: { month: string; finalized: boolean; scores: Record<string, number | null> }[]
}

const P = (v: number | null | undefined, d = 0) => (v == null ? '–' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d })}%`)
const uid = () => Math.random().toString(36).slice(2, 9)
const STATUS: Record<KpiStaffResult['status'], { label: string; tone: 'good' | 'info' | 'warn' | 'bad' | 'neutral' }> = {
  'sangat-baik': { label: 'Sangat baik', tone: 'good' },
  baik: { label: 'Baik', tone: 'info' },
  perbaikan: { label: 'Perlu perbaikan', tone: 'warn' },
  'tanpa-komisi': { label: 'Di bawah batas · tanpa komisi', tone: 'bad' },
  'belum-ada-data': { label: 'Belum ada data', tone: 'neutral' },
}
const barTone = (a: number | null, floor: number) => (a == null ? 'bg-line' : a >= 1 ? 'bg-good' : a >= floor ? 'bg-gold' : 'bg-bad')
const STAFF_DOT = ['bg-navy', 'bg-gold', 'bg-good', 'bg-bad', 'bg-ink-2']

export default function Kpi() {
  return (
    <OwnerGate title="KPI Staf">
      <KpiBody />
    </OwnerGate>
  )
}

function KpiBody() {
  const [month, setMonth] = useState(thisMonth())
  const [view, setView] = useState<'rekap' | 'atur'>('rekap')
  const { data, error, reload } = useData<KpiResponse>(`/kpi?month=${month}`)
  if (error) return <ErrorBox message={error} onRetry={reload} />
  return (
    <>
      <PageHeader
        title="KPI Staf"
        subtitle="Skor bulanan, checklist, dan komisi akhir tiap staf"
        actions={
          <>
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: 'rekap', label: 'Rekap bulanan' },
                { value: 'atur', label: 'Atur KPI' },
              ]}
            />
            <Button icon="lock" onClick={lockOwner}>
              Kunci
            </Button>
          </>
        }
      />
      {!data ? <Loading /> : view === 'rekap' ? <Rekap key={data.month} data={data} month={month} setMonth={setMonth} reload={reload} /> : <Atur data={data} reload={reload} />}
    </>
  )
}

// ======================= Rekap bulanan =======================
function Rekap({ data, month, setMonth, reload }: { data: KpiResponse; month: string; setMonth: (m: string) => void; reload: () => void }) {
  const [rec, setRec] = useState<KpiMonthRecord>(data.record)
  const [dirty, setDirty] = useState(false)
  const toast = useToast()
  useEffect(() => {
    setRec(data.record)
    setDirty(false)
  }, [data])
  const finalized = !!data.record.final
  const ctx = useMemo(() => ({ ...data.ctx, storeTarget: rec.storeTarget ?? data.storeTargetDefault }), [data, rec.storeTarget])
  const results = useMemo(() => computeKpi(data.config, rec, ctx), [data.config, rec, ctx])
  const cfg = data.config

  const updStaff = (id: string, f: (r: NonNullable<KpiMonthRecord['staff'][string]>) => void) => {
    setRec((x) => {
      const staff = { ...x.staff }
      const r = JSON.parse(JSON.stringify(staff[id] ?? {}))
      f(r)
      staff[id] = r
      return { ...x, staff }
    })
    setDirty(true)
  }
  async function save() {
    try {
      await api.put(`/kpi/month/${month}`, { record: rec })
      toast('KPI bulan ini disimpan')
      setDirty(false)
      reload()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }
  async function finalize(final: boolean) {
    if (final && dirty) await save()
    if (final && !window.confirm(`Finalisasi KPI ${monthLabel(month, true)}? Komisi tim di laporan bulan ini akan memakai faktor KPI.`)) return
    try {
      await api.post(`/kpi/month/${month}/finalize`, { final })
      toast(final ? 'KPI difinalisasi' : 'KPI dibuka kembali')
      reload()
    } catch (e) {
      toast((e as Error).message, 'bad')
    }
  }

  const totalBase = results.reduce((a, r) => a + r.baseCommission, 0)
  const totalFinal = results.reduce((a, r) => a + r.finalCommission, 0)
  return (
    <>
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Bulan" className="w-[180px]">
            <Input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </Field>
          <Field label="Target penjualan toko (pcs)" hint={data.storeTargetDefault != null ? `Dari Proyeksi: ${int(data.storeTargetDefault)} pcs` : 'Dasar target pcs host & admin'} className="w-[230px]">
            <Input
              type="number"
              min={0}
              disabled={finalized}
              value={rec.storeTarget ?? data.storeTargetDefault ?? ''}
              onChange={(e) => {
                setRec({ ...rec, storeTarget: e.target.value === '' ? null : Math.max(0, Number(e.target.value)) })
                setDirty(true)
              }}
            />
          </Field>
          <div className="ml-auto flex flex-wrap gap-2 pb-[22px]">
            {!finalized && (
              <Button onClick={save} disabled={!dirty} icon="check">
                {dirty ? 'Simpan' : 'Tersimpan'}
              </Button>
            )}
            {finalized ? (
              <Button onClick={() => finalize(false)}>Buka kembali</Button>
            ) : (
              <Button variant="primary" onClick={() => finalize(true)}>
                Finalisasi komisi
              </Button>
            )}
          </div>
        </div>
        <div className="mt-1 text-[13.5px] text-ink-2">
          Total komisi tim: dasar <span className="num font-semibold text-ink">{rp(totalBase)}</span> → setelah KPI <span className="num font-semibold text-navy">{rp(totalFinal)}</span>
        </div>
        {finalized && (
          <div className="mt-3">
            <Callout tone="good" title={`Sudah difinalisasi${data.record.finalizedAt ? ` · ${new Date(data.record.finalizedAt).toLocaleDateString('id-ID')}` : ''}`}>
              Komisi tim bulan ini di laporan dan Biaya Operasional sudah memakai faktor KPI. Buka kembali untuk mengubah.
            </Callout>
          </div>
        )}
      </Card>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {results.map((r) => (
          <StaffSummary key={r.staff.id} r={r} floor={cfg.floor} cap={cfg.cap} />
        ))}
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card title="Pencapaian per KPI" subtitle="Garis = target 100%">
          <div className="flex flex-col gap-5">
            {results.map((r) => (
              <div key={r.staff.id}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="font-semibold text-ink">{r.staff.name}</span>
                  <span className="num text-[13px] text-ink-2">Skor {P(r.score)}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  {r.lines.map((l) => (
                    <AchBar key={l.def.id} l={l} floor={cfg.floor} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Trend data={data} results={results} />
      </div>

      <div className="mt-4 flex flex-col gap-4">
        {results.map((r) => (
          <StaffDetail key={r.staff.id} r={r} rec={rec.staff[r.staff.id] ?? {}} ctx={ctx} disabled={finalized} upd={(f) => updStaff(r.staff.id, f)} />
        ))}
      </div>
    </>
  )
}

function StaffSummary({ r, floor, cap }: { r: KpiStaffResult; floor: number; cap: number }) {
  const st = STATUS[r.status]
  return (
    <Card>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-[17px] font-semibold text-ink">{r.staff.name}</div>
          <div className="text-[13px] text-muted">{r.staff.role}</div>
        </div>
        <Badge tone={st.tone}>{st.label}</Badge>
      </div>
      <div className="mt-3 flex items-end gap-2">
        <span className="num text-[34px] font-semibold leading-none text-ink">{P(r.score)}</span>
        {r.rawScore != null && r.rawScore > cap && <span className="pb-1 text-[12px] text-muted">dibatasi {P(cap)} (asli {P(r.rawScore)})</span>}
      </div>
      <div className="relative mt-3 h-2 rounded-full bg-line-soft">
        <div className={`h-2 rounded-full ${barTone(r.score, floor)}`} style={{ width: `${Math.min(100, ((r.score ?? 0) / cap) * 100)}%` }} />
        <div className="absolute -top-1 h-4 w-0.5 bg-ink/50" style={{ left: `${(1 / cap) * 100}%` }} title="100%" />
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-[12.5px]">
        <div>
          <dt className="text-muted">Komisi dasar</dt>
          <dd className="num font-medium text-ink">{r.baseCommission ? rp(r.baseCommission, { compact: true }) : '–'}</dd>
        </div>
        <div>
          <dt className="text-muted">Faktor KPI</dt>
          <dd className="num font-medium text-ink">{P(r.factor)}</dd>
        </div>
        <div>
          <dt className="text-muted">Komisi akhir</dt>
          <dd className="num font-semibold text-navy">{r.baseCommission ? rp(r.finalCommission, { compact: true }) : '–'}</dd>
        </div>
      </dl>
      {!r.baseCommission && <p className="mt-2 text-[12px] text-muted">Belum ada komisi dasar bulan ini (cek Pengaturan › Komisi tim, bulan mulai).</p>}
    </Card>
  )
}

function AchBar({ l, floor }: { l: KpiLine; floor: number }) {
  const max = 1.5
  const a = l.achievement
  return (
    <div className="grid grid-cols-[minmax(0,180px)_1fr_52px] items-center gap-2 text-[12.5px]">
      <span className="truncate text-ink-2" title={l.def.name}>
        {l.def.name}
      </span>
      <div className="relative h-3 rounded-full bg-line-soft">
        <div className={`h-3 rounded-full ${barTone(a, floor)}`} style={{ width: `${a == null ? 0 : (Math.min(a, max) / max) * 100}%` }} />
        <div className="absolute -top-0.5 h-4 w-0.5 bg-ink/50" style={{ left: `${(1 / max) * 100}%` }} />
      </div>
      <span className={`num text-right ${a == null ? 'text-muted' : a >= 1 ? 'font-semibold text-good' : 'text-ink'}`}>{a == null ? 'n/a' : P(a)}</span>
    </div>
  )
}

function Trend({ data, results }: { data: KpiResponse; results: KpiStaffResult[] }) {
  const staff = data.config.staff
  const rows = data.trend.map((t) => (t.month === data.month ? { ...t, scores: Object.fromEntries(results.map((r) => [r.staff.id, r.score])) } : t))
  const max = Math.max(data.config.cap, 1)
  return (
    <Card title="Tren skor 6 bulan">
      <div className="mb-3 flex flex-wrap gap-3 text-[12.5px] text-ink-2">
        {staff.map((s, i) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${STAFF_DOT[i % STAFF_DOT.length]}`} />
            {s.name}
          </span>
        ))}
      </div>
      <div className="relative flex h-[190px] items-end gap-2 border-b border-line-soft">
        <div className="absolute inset-x-0 border-t border-dashed border-ink/30" style={{ bottom: `${(1 / max) * 100}%` }} />
        {rows.map((t) => (
          <div key={t.month} className="flex h-full flex-1 items-end justify-center gap-0.5">
            {staff.map((s, i) => {
              const v = t.scores[s.id]
              return (
                <div
                  key={s.id}
                  className={`w-full max-w-[14px] rounded-t ${STAFF_DOT[i % STAFF_DOT.length]} ${v == null ? 'opacity-0' : ''}`}
                  style={{ height: `${((v ?? 0) / max) * 100}%` }}
                  title={`${s.name} · ${monthLabel(t.month)}: ${P(v)}`}
                />
              )
            })}
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        {rows.map((t) => (
          <div key={t.month} className="flex-1 text-center text-[11.5px] text-muted">
            {monthLabel(t.month)}
            {t.finalized ? ' ✓' : ''}
          </div>
        ))}
      </div>
      <p className="mt-2 text-[12px] text-muted">Garis putus-putus = 100%. ✓ = sudah difinalisasi.</p>
    </Card>
  )
}

function fmtActual(l: KpiLine) {
  const d = l.def
  if (l.actual == null) return '–'
  if (d.type === 'checklist') return `${Math.round(l.actual * (d.items?.length ?? 0))}/${d.items?.length ?? 0} butir`
  if (d.type === 'manual') return l.actual.toLocaleString('id-ID')
  const m = d.metric ? METRICS[d.metric] : null
  if (d.metric === 'live_ontime') return `${P(l.actual, 1)} sesi tepat waktu`
  if (m?.unit === 'pct') return P(l.actual, 1)
  if (m?.unit === 'pcs') return `${int(l.actual)} pcs`
  return `${int(l.actual)} sesi`
}

function StaffDetail({ r, rec, ctx, disabled, upd }: { r: KpiStaffResult; rec: KpiMonthRecord['staff'][string]; ctx: KpiContext; disabled: boolean; upd: (f: (x: KpiMonthRecord['staff'][string]) => void) => void }) {
  return (
    <Card title={`${r.staff.name} · ${r.staff.role}`} subtitle={`Skor ${P(r.score)} · total bobot ${int(r.weightTotal)}%`} padded={false}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13.5px]">
          <thead>
            <tr className="border-b border-line-soft text-left text-[12px] uppercase tracking-wide text-muted">
              <th className="px-5 py-2.5 font-medium">KPI</th>
              <th className="px-3 py-2.5 text-right font-medium">Bobot</th>
              <th className="px-3 py-2.5 font-medium">Target</th>
              <th className="px-3 py-2.5 font-medium">Realisasi</th>
              <th className="px-3 py-2.5 text-right font-medium">Pencapaian</th>
              <th className="px-5 py-2.5 text-right font-medium">Kontribusi</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l) => {
              const d = l.def
              const m = d.metric ? METRICS[d.metric] : null
              return (
                <tr key={d.id} className="border-b border-line-soft align-top last:border-0">
                  <td className="px-5 py-3">
                    <div className="font-medium text-ink">{d.name}</div>
                    <div className="text-[12px] text-muted">{d.type === 'auto' ? `Otomatis · ${m?.label ?? ''}` : d.type === 'checklist' ? 'Checklist owner' : 'Diisi owner'}</div>
                    {d.type === 'checklist' && (
                      <div className="mt-2 flex flex-col gap-1.5">
                        {(d.items ?? []).map((it, i) => (
                          <label key={i} className="flex items-start gap-2 text-[13px] text-ink-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 accent-[#1f2a44]"
                              disabled={disabled}
                              checked={!!rec?.checks?.[d.id]?.[i]}
                              onChange={(e) =>
                                upd((x) => {
                                  x!.checks = x!.checks ?? {}
                                  const arr = [...(x!.checks[d.id] ?? [])]
                                  arr[i] = e.target.checked
                                  x!.checks[d.id] = arr
                                })
                              }
                            />
                            {it}
                          </label>
                        ))}
                      </div>
                    )}
                    {l.reason && l.achievement == null && <div className="mt-1 text-[12px] text-warn">{l.reason} · tidak ikut dihitung</div>}
                  </td>
                  <td className="num px-3 py-3 text-right">{int(d.weight)}%</td>
                  <td className="px-3 py-3">
                    {d.type === 'manual' || d.metric === 'live_sessions' ? (
                      <Input
                        className="h-8 w-[90px] text-right"
                        type="number"
                        min={0}
                        disabled={disabled}
                        value={rec?.targets?.[d.id] ?? d.target}
                        onChange={(e) =>
                          upd((x) => {
                            x!.targets = { ...(x!.targets ?? {}), [d.id]: Math.max(0, Number(e.target.value)) }
                          })
                        }
                      />
                    ) : d.type === 'checklist' ? (
                      <span className="text-ink-2">Semua butir</span>
                    ) : m?.targetIsShare ? (
                      <span className="text-ink-2">
                        {P(l.target)} × {ctx.storeTarget ? `${int(ctx.storeTarget)} pcs` : 'target toko'}
                        {l.targetValue != null && <span className="block num font-medium text-ink">= {int(l.targetValue)} pcs</span>}
                      </span>
                    ) : (
                      <span className="text-ink-2">
                        {m?.higherBetter ? '≥' : '≤'} {P(l.target, 1)}
                        {d.metric === 'live_ontime' && <span className="block text-[12px] text-muted">telat maks. {d.toleranceMin ?? 10} mnt</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {d.type === 'manual' ? (
                      <Input
                        className="h-8 w-[90px] text-right"
                        type="number"
                        min={0}
                        disabled={disabled}
                        placeholder="Isi"
                        value={rec?.manual?.[d.id] ?? ''}
                        onChange={(e) =>
                          upd((x) => {
                            const mm = { ...(x!.manual ?? {}) }
                            if (e.target.value === '') delete mm[d.id]
                            else mm[d.id] = Number(e.target.value)
                            x!.manual = mm
                          })
                        }
                      />
                    ) : (
                      <span className="num">{fmtActual(l)}</span>
                    )}
                  </td>
                  <td className={`num px-3 py-3 text-right ${l.achievement == null ? 'text-muted' : l.achievement >= 1 ? 'font-semibold text-good' : 'text-ink'}`}>{l.achievement == null ? 'n/a' : P(l.achievement)}</td>
                  <td className="num px-5 py-3 text-right">{l.achievement == null ? '–' : P(l.contribution, 1)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ======================= Atur KPI =======================
const TYPE_OPTS: { value: KpiType; label: string }[] = [
  { value: 'auto', label: 'Otomatis dari data' },
  { value: 'checklist', label: 'Checklist owner' },
  { value: 'manual', label: 'Diisi owner (angka)' },
]
const METRIC_OPTS = (Object.keys(METRICS) as KpiMetric[]).map((k) => ({ value: k, label: METRICS[k].label }))
// target disimpan sebagai pecahan untuk metrik persen/porsi, ditampilkan sebagai persen
const isPctTarget = (d: KpiDef) => d.type === 'auto' && !!d.metric && (METRICS[d.metric].unit === 'pct' || !!METRICS[d.metric].targetIsShare)

function Atur({ data, reload }: { data: KpiResponse; reload: () => void }) {
  const [cfg, setCfg] = useState<KpiConfig>(data.config)
  const [dirty, setDirty] = useState(false)
  const toast = useToast()
  const set = (c: KpiConfig) => {
    setCfg(c)
    setDirty(true)
  }
  const setStaff = (id: string, patch: Partial<KpiStaff>) => set({ ...cfg, staff: cfg.staff.map((s) => (s.id === id ? { ...s, ...patch } : s)) })
  const setKpi = (sid: string, kid: string, patch: Partial<KpiDef>) =>
    set({ ...cfg, staff: cfg.staff.map((s) => (s.id === sid ? { ...s, kpis: s.kpis.map((k) => (k.id === kid ? { ...k, ...patch } : k)) } : s)) })
  async function save() {
    for (const s of cfg.staff) {
      const w = s.kpis.reduce((a, k) => a + k.weight, 0)
      if (Math.round(w) !== 100 && !window.confirm(`Total bobot ${s.name} ${w}% (bukan 100%). Bobot akan dihitung proporsional. Tetap simpan?`)) return
    }
    await api.put('/kpi/config', { config: cfg })
    toast('Pengaturan KPI disimpan')
    setDirty(false)
    reload()
  }
  const memberOpts = [...new Set([...data.members, ...cfg.staff.map((s) => s.commissionMember)])].filter(Boolean)
  return (
    <>
      <Card
        title="Aturan komisi dari skor KPI"
        actions={
          <div className="flex gap-2">
            <Button
              onClick={() => {
                if (window.confirm('Kembalikan semua KPI ke usulan bawaan?')) set(DEFAULT_KPI_CONFIG)
              }}
            >
              Bawaan
            </Button>
            <Button variant="primary" icon="check" onClick={save} disabled={!dirty}>
              {dirty ? 'Simpan' : 'Tersimpan'}
            </Button>
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Skor maksimal (%)" hint="Skor di atas ini dibatasi">
            <Input type="number" min={100} value={Math.round(cfg.cap * 100)} onChange={(e) => set({ ...cfg, cap: Math.max(1, Number(e.target.value) / 100) })} />
          </Field>
          <Field label="Batas minimal komisi (%)" hint="Di bawah skor ini komisi 0">
            <Input type="number" min={0} max={100} value={Math.round(cfg.floor * 100)} onChange={(e) => set({ ...cfg, floor: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })} />
          </Field>
        </div>
        <p className="mt-3 text-[13px] text-ink-2">
          Komisi akhir = komisi dasar × skor KPI. Skor {P(cfg.floor)}–100% mengurangi komisi sebanding; di atas 100% menambah sesuai bobot KPI yang dilampaui, paling tinggi {P(cfg.cap)}.
        </p>
      </Card>

      {cfg.staff.map((s) => {
        const w = s.kpis.reduce((a, k) => a + k.weight, 0)
        return (
          <div key={s.id} className="mt-4">
            <Card
              title={s.name || 'Staf baru'}
              subtitle={
                <span className={Math.round(w) === 100 ? '' : 'text-warn'}>
                  Total bobot {int(w)}%{Math.round(w) === 100 ? '' : ' · sebaiknya 100%'}
                </span>
              }
              actions={<IconButton icon="trash" label={`Hapus ${s.name}`} tone="danger" onClick={() => window.confirm(`Hapus ${s.name} dari KPI?`) && set({ ...cfg, staff: cfg.staff.filter((x) => x.id !== s.id) })} />}
            >
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Nama">
                  <Input value={s.name} onChange={(e) => setStaff(s.id, { name: e.target.value })} />
                </Field>
                <Field label="Peran">
                  <Input value={s.role} onChange={(e) => setStaff(s.id, { role: e.target.value })} />
                </Field>
                <Field label="Nama di Komisi tim" hint="Pengaturan › Komisi tim per orang">
                  <Select value={s.commissionMember} options={[{ value: '', label: 'Tanpa komisi' }, ...memberOpts]} onChange={(e) => setStaff(s.id, { commissionMember: e.target.value })} />
                </Field>
                <Field label="Nama host di Sesi Live" hint="Kosong = sama dengan nama">
                  <Input value={s.hostName ?? ''} onChange={(e) => setStaff(s.id, { hostName: e.target.value || undefined })} />
                </Field>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                {s.kpis.map((k) => (
                  <div key={k.id} className="rounded-xl border border-line-soft p-3">
                    <div className="grid items-end gap-2 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1.3fr_100px_90px_100px_32px]">
                      <Field label="Nama KPI">
                        <Input className="h-9" value={k.name} onChange={(e) => setKpi(s.id, k.id, { name: e.target.value })} />
                      </Field>
                      <Field label="Jenis">
                        <Select
                          className="h-9"
                          value={k.type}
                          options={TYPE_OPTS}
                          onChange={(e) => {
                            const type = e.target.value as KpiType
                            setKpi(s.id, k.id, type === 'auto' ? { type, metric: k.metric ?? 'store_pcs', target: 1 } : type === 'checklist' ? { type, items: k.items?.length ? k.items : ['Butir 1'], target: 1, maxAchieve: 1 } : { type, target: 100, maxAchieve: 1 })
                          }}
                        />
                      </Field>
                      {k.type === 'auto' ? (
                        <Field label="Data">
                          <Select
                            className="h-9"
                            value={k.metric ?? ''}
                            options={METRIC_OPTS}
                            onChange={(e) => {
                              const metric = e.target.value as KpiMetric
                              const mm = METRICS[metric]
                              setKpi(s.id, k.id, {
                                metric,
                                target: metric === 'live_sessions' ? 26 : mm.unit === 'pct' ? (mm.higherBetter ? 1 : 0.03) : mm.targetIsShare ? 1 : k.target,
                                maxAchieve: mm.higherBetter && mm.unit !== 'pct' && metric !== 'live_sessions' ? 1.5 : 1,
                                toleranceMin: metric === 'live_ontime' ? (k.toleranceMin ?? 10) : undefined,
                              })
                            }}
                          />
                        </Field>
                      ) : (
                        <div className="hidden lg:block" />
                      )}
                      <Field label={k.type === 'auto' && k.metric ? METRICS[k.metric].targetLabel : k.type === 'checklist' ? 'Target' : 'Target'}>
                        {k.type === 'checklist' ? (
                          <Input className="h-9" disabled value="Semua" />
                        ) : (
                          <Input
                            className="h-9 text-right"
                            type="number"
                            step="any"
                            value={isPctTarget(k) ? Math.round(k.target * 10000) / 100 : k.target}
                            onChange={(e) => setKpi(s.id, k.id, { target: isPctTarget(k) ? Number(e.target.value) / 100 : Number(e.target.value) })}
                          />
                        )}
                      </Field>
                      <Field label="Bobot %">
                        <Input className="h-9 text-right" type="number" min={0} value={k.weight} onChange={(e) => setKpi(s.id, k.id, { weight: Math.max(0, Number(e.target.value)) })} />
                      </Field>
                      <Field label="Maks capai %">
                        <Input className="h-9 text-right" type="number" min={100} value={Math.round(k.maxAchieve * 100)} onChange={(e) => setKpi(s.id, k.id, { maxAchieve: Math.max(1, Number(e.target.value) / 100) })} />
                      </Field>
                      <div className="pb-0.5">
                        <IconButton icon="trash" label="Hapus KPI" tone="danger" onClick={() => setStaff(s.id, { kpis: s.kpis.filter((x) => x.id !== k.id) })} />
                      </div>
                    </div>
                    {k.type === 'checklist' && (
                      <Field label="Butir checklist (satu per baris)" className="mt-2">
                        <Textarea rows={Math.max(2, (k.items ?? []).length)} value={(k.items ?? []).join('\n')} onChange={(e) => setKpi(s.id, k.id, { items: e.target.value.split('\n') })} onBlur={(e) => setKpi(s.id, k.id, { items: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} />
                      </Field>
                    )}
                    {k.type === 'manual' && <p className="mt-1.5 text-[12px] text-muted">Owner mengisi realisasi tiap bulan. Pencapaian = realisasi ÷ target.</p>}
                    {k.type === 'auto' && k.metric === 'live_ontime' && (
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <Field label="Toleransi telat (menit)" className="w-[170px]">
                          <Input className="h-9 text-right" type="number" min={0} value={k.toleranceMin ?? 10} onChange={(e) => setKpi(s.id, k.id, { toleranceMin: Math.max(0, Number(e.target.value)) })} />
                        </Field>
                        <p className="pb-2 text-[12px] text-muted">Dari Sesi Live: jam mulai dibanding jam jadwal. Sesi tanpa jam jadwal tidak dihitung.</p>
                      </div>
                    )}
                  </div>
                ))}
                <div>
                  <Button icon="plus" onClick={() => setStaff(s.id, { kpis: [...s.kpis, { id: uid(), name: 'KPI baru', type: 'checklist', weight: 0, target: 1, maxAchieve: 1, items: ['Butir 1'] }] })}>
                    Tambah KPI
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )
      })}
      <div className="mt-4">
        <Button icon="plus" onClick={() => set({ ...cfg, staff: [...cfg.staff, { id: uid(), name: 'Staf baru', role: '', commissionMember: '', kpis: [] }] })}>
          Tambah staf
        </Button>
      </div>
    </>
  )
}
