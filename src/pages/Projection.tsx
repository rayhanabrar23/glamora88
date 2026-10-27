import { useEffect, useMemo, useState } from 'react'
import { addMonths, projectionMonths, runProjection, type CostItem, type OneOff, type Restock, type Scenario } from '../../shared/projection'
import { api } from '../lib/api'
import { int, monthLabel, pct, rp, thisMonth } from '../lib/format'
import { useData } from '../lib/useData'
import { CashChart } from '../components/charts'
import { Button, Callout, Card, ErrorBox, Field, IconButton, Input, Loading, PageHeader, Stat, Table, td, tdNum, th, useToast } from '../components/ui'

interface Base {
  avgPrice: number
  landedCost: number
  commissionPct: number
  perOrderFee: number
  teamCommissionPerPcs: number
  pcsPerOrder: number
  openingStock: number
  avgPcs: number
  avgPcsSelling: number
  bestPcs: number
  plannedFixed: number | null
  lastFixed: { month: string; amount: number } | null
  avgBoost: number
  saved: Scenario | null
  feeSource?: 'settlement' | 'tarif'
}

const uid = () => Math.random().toString(36).slice(2, 9)
const round = (v: number, step = 1) => Math.round(v / step) * step

function defaultScenario(b: Base): Scenario {
  const start = addMonths(thisMonth(), 1)
  const [, m] = start.split('-').map(Number)
  const months = 12 - m + 13 // sampai Desember tahun berikutnya
  const vol = Math.round(b.avgPcsSelling)
  const current = round((b.lastFixed?.amount ?? 0) + b.avgBoost, 1000)
  const costs: CostItem[] = []
  if (b.plannedFixed) {
    costs.push({ id: uid(), name: 'Biaya tetap & boost saat ini', amount: current, from: start, to: start })
    costs.push({ id: uid(), name: 'Biaya tetap rencana (dari Pengaturan)', amount: round(b.plannedFixed, 1000), from: addMonths(start, 1) })
  } else costs.push({ id: uid(), name: 'Biaya tetap & boost saat ini', amount: current, from: start })
  const s: Scenario = {
    start,
    months,
    openingCash: 0,
    openingStock: b.openingStock,
    price: round(b.avgPrice, 100),
    landedCost: round(b.landedCost, 100),
    commissionPct: b.commissionPct,
    perOrderFee: round(b.perOrderFee, 10),
    teamCommissionPerPcs: round(b.teamCommissionPerPcs, 10),
    pcsPerOrder: Math.round(b.pcsPerOrder * 100) / 100,
    volume: {},
    costs,
    oneOffs: [],
    restocks: [],
  }
  for (const mm of projectionMonths(s)) s.volume[mm] = vol
  return s
}

export default function Projection() {
  const { data: base, error, reload } = useData<Base>('/projection/base')
  const [s, setS] = useState<Scenario | null>(null)
  const [dirty, setDirty] = useState(false)
  const toast = useToast()
  useEffect(() => {
    if (base && !s) setS(base.saved ?? defaultScenario(base))
  }, [base, s])
  const result = useMemo(() => (s ? runProjection(s) : null), [s])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!base || !s || !result) return <Loading />

  const upd = (patch: Partial<Scenario>) => {
    setS((x) => {
      const next = { ...x!, ...patch }
      // jaga volume tetap ada untuk setiap bulan
      const vol: Record<string, number> = {}
      const fill = x!.volume[projectionMonths(x!)[projectionMonths(x!).length - 1]] ?? 0
      for (const m of projectionMonths(next)) vol[m] = next.volume[m] ?? fill
      return { ...next, volume: vol }
    })
    setDirty(true)
  }
  const months = projectionMonths(s)
  const setAllVolume = (v: number) => upd({ volume: Object.fromEntries(months.map((m) => [m, Math.max(0, Math.round(v))])) })
  const ramp = (fromV: number, toV: number) =>
    upd({ volume: Object.fromEntries(months.map((m, i) => [m, Math.round(fromV + ((toV - fromV) * i) / Math.max(1, months.length - 1))])) })
  async function save() {
    await api.put('/settings', { projection: JSON.stringify(s) })
    setDirty(false)
    toast('Skenario disimpan untuk seluruh tim')
  }
  function reset() {
    if (!window.confirm('Kembalikan semua asumsi ke angka dari data terbaru?')) return
    setS(defaultScenario(base!))
    setDirty(true)
  }
  const bep = (() => {
    const unit = s.price * (1 - s.commissionPct) - s.perOrderFee / (s.pcsPerOrder || 1) - s.teamCommissionPerPcs - s.landedCost
    const fixed = s.costs.filter((c) => c.from <= months[months.length - 1] && (!c.to || c.to >= months[months.length - 1])).reduce((a, c) => a + c.amount, 0)
    return { unit, fixed, pcs: unit > 0 ? fixed / unit : null }
  })()

  const r = result
  return (
    <>
      <PageHeader
        title="Proyeksi Kas"
        subtitle={`${monthLabel(months[0], true)} – ${monthLabel(months[months.length - 1], true)}`}
        actions={
          <>
            <Button icon="download" onClick={reset}>
              Isi ulang dari data
            </Button>
            <Button variant="primary" icon="check" onClick={save} disabled={!dirty}>
              {dirty ? 'Simpan skenario' : 'Tersimpan'}
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          label="Titik kas terendah"
          value={rp(r.lowestCash, { compact: true })}
          tone={r.lowestCash < 0 ? 'bad' : 'good'}
          hint={r.lowestMonth ? `Terjadi di ${monthLabel(r.lowestMonth, true)}` : 'Kas tidak pernah turun dari saldo awal'}
        />
        <Stat
          label="Modal yang perlu disiapkan"
          value={rp(r.fundingNeed, { compact: true })}
          tone={r.fundingNeed > 0 ? 'bad' : 'good'}
          hint={r.fundingNeed > 0 ? 'Agar kas tidak pernah minus' : 'Saldo awal sudah cukup'}
        />
        <Stat
          label="Laba (rugi) operasional periode ini"
          value={rp(r.totalProfit, { compact: true })}
          tone={r.totalProfit >= 0 ? 'good' : 'bad'}
          hint={r.firstProfitMonth ? `Untung pertama: ${monthLabel(r.firstProfitMonth, true)}` : 'Belum ada bulan yang untung'}
        />
        <Stat
          label="Titik impas (akhir periode)"
          value={bep.pcs ? `${int(bep.pcs)} pcs/bln` : '–'}
          hint={`Margin ${rp(bep.unit, { compact: true })}/pcs · biaya tetap ${rp(bep.fixed, { compact: true })}/bln`}
        />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        {r.stockOutMonth && (
          <Callout tone="warning" title={`Stok habis di ${monthLabel(r.stockOutMonth, true)}`}>
          </Callout>
        )}
        <Callout tone={r.endCash >= s.openingCash ? 'good' : r.fundingNeed > 0 ? 'critical' : 'info'} title="Kesimpulan skenario">
          Dengan rata-rata {int(months.reduce((a, m) => a + (s.volume[m] ?? 0), 0) / months.length)} pcs/bulan, kas berubah dari {rp(s.openingCash, { compact: true })} menjadi{' '}
          <b>{rp(r.endCash, { compact: true })}</b> di akhir {monthLabel(months[months.length - 1], true)}.{' '}
          {r.fundingNeed > 0
            ? `Siapkan modal minimal ${rp(r.fundingNeed, { compact: true })} agar operasional tidak terhenti.`
            : 'Tidak perlu tambahan modal pada skenario ini.'}
        </Callout>
      </div>

      <div className="mt-4">
        <Card title="Saldo kas per bulan">
          <CashChart data={r.rows.map((x) => ({ month: x.month, cumulativeCash: x.cashEnd, netCash: x.netCash }))} />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <Card title="Asumsi dasar">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Mulai bulan">
              <Input type="month" value={s.start} onChange={(e) => e.target.value && upd({ start: e.target.value })} />
            </Field>
            <Field label="Lama proyeksi (bulan)">
              <Input type="number" min={1} max={36} value={s.months} onChange={(e) => upd({ months: Math.min(36, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="Saldo kas awal (Rp)">
              <Input type="number" value={s.openingCash} onChange={(e) => upd({ openingCash: Number(e.target.value) })} />
            </Field>
            <Field label="Stok awal (pcs)" hint={`Dari data: ${int(base.openingStock)} pcs`}>
              <Input type="number" value={s.openingStock} onChange={(e) => upd({ openingStock: Number(e.target.value) })} />
            </Field>
            <Field label="Harga jual rata-rata (Rp/pcs)" hint={`Data: ${rp(base.avgPrice)}`}>
              <Input type="number" value={s.price} onChange={(e) => upd({ price: Number(e.target.value) })} />
            </Field>
            <Field label="HPP / landed cost (Rp/pcs)" hint={`Data: ${rp(base.landedCost)}`}>
              <Input type="number" value={s.landedCost} onChange={(e) => upd({ landedCost: Number(e.target.value) })} />
            </Field>
            <Field label="Potongan TikTok (% omzet)" hint={base.feeSource === 'settlement' ? 'Dari laporan settlement (potongan asli)' : 'Komisi platform + dinamis (tarif)'}>
              <Input
                type="number"
                step="0.1"
                value={Math.round(s.commissionPct * 1000) / 10}
                onChange={(e) => upd({ commissionPct: Number(e.target.value) / 100 })}
              />
            </Field>
            <Field label="Biaya per pesanan (Rp)">
              <Input type="number" value={s.perOrderFee} onChange={(e) => upd({ perOrderFee: Number(e.target.value) })} />
            </Field>
            <Field label="Komisi tim (Rp/pcs)" hint={`Data: ${rp(base.teamCommissionPerPcs)}`}>
              <Input type="number" value={s.teamCommissionPerPcs} onChange={(e) => upd({ teamCommissionPerPcs: Number(e.target.value) })} />
            </Field>
            <Field label="Pcs per pesanan" hint={`Data: ${base.pcsPerOrder.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`}>
              <Input type="number" step="0.01" value={s.pcsPerOrder} onChange={(e) => upd({ pcsPerOrder: Number(e.target.value) })} />
            </Field>
          </div>
          <p className="mt-4 text-[13px] text-muted">
            Margin per pcs setelah semua potongan & HPP: <b className="num text-ink">{rp(bep.unit)}</b> ({pct(s.price ? bep.unit / s.price : 0)} dari harga jual).
          </p>
        </Card>

        <Card title="Volume penjualan (pcs neto per bulan)">
          <div className="mb-4 flex flex-wrap gap-2">
            <Button onClick={() => setAllVolume(base.avgPcsSelling)}>Rata-rata bulan aktif ({int(base.avgPcsSelling)})</Button>
            <Button onClick={() => setAllVolume(base.bestPcs)}>Bulan terbaik ({int(base.bestPcs)})</Button>
            {bep.pcs && <Button onClick={() => setAllVolume(Math.ceil(bep.pcs!))}>Titik impas ({int(bep.pcs)})</Button>}
            <Button onClick={() => ramp(Math.round(base.avgPcsSelling), Math.ceil((bep.pcs ?? base.bestPcs) * 1.2))}>Naik bertahap ke titik impas +20%</Button>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
            {months.map((m) => (
              <Field key={m} label={monthLabel(m)}>
                <Input type="number" min={0} className="text-right" value={s.volume[m] ?? 0} onChange={(e) => upd({ volume: { ...s.volume, [m]: Number(e.target.value) } })} />
              </Field>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ListCard<CostItem>
          title="Biaya tetap bulanan"
          items={s.costs}
          onChange={(costs) => upd({ costs })}
          make={() => ({ id: uid(), name: 'Biaya baru', amount: 0, from: s.start })}
          fields={[
            { key: 'name', label: 'Nama', type: 'text', span: 2 },
            { key: 'amount', label: 'Rp / bulan', type: 'number', span: 2 },
            { key: 'from', label: 'Mulai', type: 'month', span: 2 },
            { key: 'to', label: 'Selesai (opsional)', type: 'month', span: 2 },
          ]}
        />
        <ListCard<Restock>
          title="Rencana restock"
          items={s.restocks}
          onChange={(restocks) => upd({ restocks })}
          make={() => ({ id: uid(), month: addMonths(s.start, 1), pcs: 300, costPerPcs: s.landedCost })}
          fields={[
            { key: 'month', label: 'Bulan', type: 'month', span: 2 },
            { key: 'pcs', label: 'Pcs', type: 'number' },
            { key: 'costPerPcs', label: 'Biaya/pcs (Rp)', type: 'number' },
          ]}
        />
        <ListCard<OneOff>
          title="Kas sekali (keluar / masuk)"
          subtitle="Minus = uang masuk"
          items={s.oneOffs}
          onChange={(oneOffs) => upd({ oneOffs })}
          make={() => ({ id: uid(), name: 'Pengeluaran', month: s.start, amount: 0 })}
          fields={[
            { key: 'name', label: 'Nama', type: 'text', span: 2 },
            { key: 'month', label: 'Bulan', type: 'month', span: 2 },
            { key: 'amount', label: 'Rp', type: 'number', span: 2 },
          ]}
        />
      </div>

      <div className="mt-4">
        <Card title="Rincian per bulan" padded={false}>
          <Table
            head={
              <tr>
                <th className={th}>Bulan</th>
                <th className={`${th} text-right`}>Pcs</th>
                <th className={`${th} text-right`}>Omzet</th>
                <th className={`${th} text-right`}>Potongan TikTok</th>
                <th className={`${th} text-right`}>Komisi tim</th>
                <th className={`${th} text-right`}>Biaya tetap</th>
                <th className={`${th} text-right`}>Kas sekali</th>
                <th className={`${th} text-right`}>Restock</th>
                <th className={`${th} text-right`}>Arus kas</th>
                <th className={`${th} text-right`}>Saldo kas</th>
                <th className={`${th} text-right`}>Laba operasional</th>
                <th className={`${th} text-right`}>Stok akhir</th>
              </tr>
            }
          >
            {r.rows.map((x) => (
              <tr key={x.month}>
                <td className={`${td} whitespace-nowrap`}>{monthLabel(x.month, true)}</td>
                <td className={tdNum}>
                  {int(x.pcs)}
                  {x.stockShort > 0 && <span className="text-warn"> (−{int(x.stockShort)})</span>}
                </td>
                <td className={tdNum}>{rp(x.omzet, { compact: true })}</td>
                <td className={tdNum}>{rp(-x.platformFees, { compact: true })}</td>
                <td className={tdNum}>{rp(-x.teamCommission, { compact: true })}</td>
                <td className={tdNum}>{rp(-x.fixedCosts, { compact: true })}</td>
                <td className={tdNum}>{x.oneOff ? rp(-x.oneOff, { compact: true }) : '–'}</td>
                <td className={tdNum}>{x.purchases ? rp(-x.purchases, { compact: true }) : '–'}</td>
                <td className={`${tdNum} ${x.netCash < 0 ? 'text-bad' : 'text-good'}`}>{rp(x.netCash, { compact: true })}</td>
                <td className={`${tdNum} font-semibold ${x.cashEnd < 0 ? 'text-bad' : ''}`}>{rp(x.cashEnd, { compact: true })}</td>
                <td className={`${tdNum} ${x.operatingProfit < 0 ? 'text-bad' : 'text-good'}`}>{rp(x.operatingProfit, { compact: true })}</td>
                <td className={tdNum}>{int(x.stockEnd)}</td>
              </tr>
            ))}
          </Table>
          <p className="border-t border-line-soft px-5 py-3 text-[12.5px] text-muted">
            Arus kas = dana cair TikTok − komisi tim − biaya tetap − kas sekali − restock. Laba operasional memakai HPP (stok lama yang terjual), sehingga bisa berbeda dari arus kas.
            Belum termasuk gaji owner & pajak.
          </p>
        </Card>
      </div>
    </>
  )
}

type FieldDef<T> = { key: keyof T & string; label: string; type: 'text' | 'number' | 'month'; span?: number }
function ListCard<T extends { id: string }>({
  title,
  subtitle,
  items,
  onChange,
  make,
  fields,
}: {
  title: string
  subtitle?: string
  items: T[]
  onChange: (v: T[]) => void
  make: () => T
  fields: FieldDef<T>[]
}) {
  const set = (id: string, k: keyof T, v: unknown) => onChange(items.map((x) => (x.id === id ? { ...x, [k]: v } : x)))
  return (
    <Card title={title} subtitle={subtitle} actions={<Button icon="plus" onClick={() => onChange([...items, make()])}>Tambah</Button>}>
      <div className="flex flex-col gap-3">
        {!items.length && <p className="text-[13.5px] text-muted">Belum ada.</p>}
        {items.map((it) => (
          <div key={it.id} className="rounded-xl border border-line-soft p-3">
            <div className="grid grid-cols-2 gap-2">
              {fields.map((f) => (
                <label key={f.key} className={f.span === 2 ? 'col-span-2' : ''}>
                  <span className="mb-1 block text-[12px] text-muted">{f.label}</span>
                  <Input
                    className="h-9"
                    type={f.type}
                    value={(it[f.key] as unknown as string | number | undefined) ?? ''}
                    onChange={(e) => set(it.id, f.key, f.type === 'number' ? Number(e.target.value) : e.target.value || undefined)}
                  />
                </label>
              ))}
            </div>
            <div className="mt-1 flex justify-end">
              <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => onChange(items.filter((x) => x.id !== it.id))} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}
