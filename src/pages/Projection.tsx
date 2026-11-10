import { useEffect, useMemo, useState } from 'react'
import { addMonths, normalizeScenario, projectionMonths, runProjection, upgradeScenario, type CostItem, type Fund, type OneOff, type Restock, type Scenario } from '../../shared/projection'
import type { StockRow } from '../../shared/metrics'
import { api } from '../lib/api'
import { int, monthLabel, pct, rp, thisMonth } from '../lib/format'
import { useData } from '../lib/useData'
import { CashChart } from '../components/charts'
import { Button, Callout, Card, ErrorBox, Field, IconButton, Input, Loading, PageHeader, Select, Stat, Table, Tabs, td, tdNum, th, useToast } from '../components/ui'

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
    funds: [],
    volumeMode: 'flat',
    volumeFlat: vol,
    restockMode: 'routine',
    restockPcs: 0,
    restockEvery: 1,
  }
  return normalizeScenario(s)
}

export default function Projection() {
  const { data: base, error, reload } = useData<Base>('/projection/base')
  const { data: stock } = useData<StockRow[]>('/stock')
  const [s, setS] = useState<Scenario | null>(null)
  const [dirty, setDirty] = useState(false)
  const toast = useToast()
  useEffect(() => {
    if (base && !s) setS(base.saved ? upgradeScenario(base.saved) : defaultScenario(base))
  }, [base, s])
  const result = useMemo(() => (s ? runProjection(s) : null), [s])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!base || !s || !result) return <Loading />

  const upd = (patch: Partial<Scenario>) => {
    setS((x) => normalizeScenario({ ...x!, ...patch }))
    setDirty(true)
  }
  const months = projectionMonths(s)
  const first = s.volume[months[0]] ?? 0
  const lastV = s.volume[months[months.length - 1]] ?? 0
  const setVolumeMode = (mode: NonNullable<Scenario['volumeMode']>) =>
    upd(
      mode === 'flat'
        ? { volumeMode: mode, volumeFlat: s.volumeFlat ?? first }
        : mode === 'ramp'
          ? { volumeMode: mode, rampFrom: s.rampFrom ?? first, rampTo: s.rampTo ?? lastV, rampMonths: s.rampMonths ?? Math.min(6, months.length) }
          : { volumeMode: mode },
    )
  const setRestockMode = (mode: NonNullable<Scenario['restockMode']>) =>
    // "atur sendiri" berangkat dari jadwal yang sedang tampil supaya tidak mengetik ulang
    upd(mode === 'manual' ? { restockMode: mode, restocks: s.restocks.map((x) => ({ ...x, id: uid() })) } : { restockMode: mode, restockPcs: s.restockPcs ?? 0, restockEvery: s.restockEvery ?? 1 })
  const funds = s.funds ?? []
  const setFund = (id: string, patch: Partial<Fund>) => upd({ funds: funds.map((f) => (f.id === id ? { ...f, ...patch } : f)) })
  const addFund = (name: string) => upd({ funds: [...funds, { id: uid(), name, amount: 0 }] })
  const setOneOff = (id: string, patch: Partial<OneOff>) => upd({ oneOffs: s.oneOffs.map((o) => (o.id === id ? { ...o, ...patch } : o)) })
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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="1 · Periode & dana awal" subtitle="Dana yang sudah di tangan saat proyeksi dimulai">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Mulai bulan">
              <Input type="month" value={s.start} onChange={(e) => e.target.value && upd({ start: e.target.value })} />
            </Field>
            <Field label="Lama proyeksi (bulan)">
              <Input type="number" min={1} max={36} value={s.months} onChange={(e) => upd({ months: Math.min(36, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
          </div>
          <div className="mt-5 flex flex-col gap-2">
            {funds.map((f) => (
              <div key={f.id} className="grid grid-cols-[1fr_150px_32px] items-end gap-2 sm:grid-cols-[1fr_190px_32px]">
                <label>
                  <span className="mb-1 block text-[12px] text-muted">Sumber dana</span>
                  <Input className="h-9" value={f.name} onChange={(e) => setFund(f.id, { name: e.target.value })} />
                </label>
                <label>
                  <span className="mb-1 block text-[12px] text-muted">Rp · {rp(f.amount, { compact: true })}</span>
                  <Input className="h-9 text-right" type="number" min={0} value={f.amount} onChange={(e) => setFund(f.id, { amount: Math.abs(Number(e.target.value)) })} />
                </label>
                <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => upd({ funds: funds.filter((x) => x.id !== f.id) })} />
              </div>
            ))}
            {!funds.length && <p className="text-[13.5px] text-muted">Belum ada dana awal.</p>}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {['Kas / laba yang bisa dipakai', 'Tambahan modal owner', 'Dana investor'].map((n) => (
              <Button key={n} icon="plus" onClick={() => addFund(n)}>
                {n}
              </Button>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-between rounded-2xl bg-gold-soft px-4 py-3">
            <span className="text-[13.5px] font-medium text-[#7a5c2b]">Saldo kas awal</span>
            <span className="num text-[17px] font-semibold text-ink">{rp(s.openingCash)}</span>
          </div>
        </Card>

        <Card
          title="2 · Volume penjualan"
          subtitle="Pcs neto per bulan"
          actions={
            <Tabs
              value={s.volumeMode ?? 'manual'}
              onChange={setVolumeMode}
              items={[
                { value: 'flat', label: 'Rata' },
                { value: 'ramp', label: 'Naik bertahap' },
                { value: 'manual', label: 'Per bulan' },
              ]}
            />
          }
        >
          {s.volumeMode === 'flat' && (
            <>
              <Field label="Penjualan tiap bulan (pcs)">
                <Input type="number" min={0} value={s.volumeFlat ?? 0} onChange={(e) => upd({ volumeFlat: Number(e.target.value) })} />
              </Field>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => upd({ volumeFlat: Math.round(base.avgPcsSelling) })}>Rata-rata bulan aktif ({int(base.avgPcsSelling)})</Button>
                <Button onClick={() => upd({ volumeFlat: base.bestPcs })}>Bulan terbaik ({int(base.bestPcs)})</Button>
                {bep.pcs && <Button onClick={() => upd({ volumeFlat: Math.ceil(bep.pcs!) })}>Titik impas ({int(bep.pcs)})</Button>}
              </div>
            </>
          )}
          {s.volumeMode === 'ramp' && (
            <div className="grid grid-cols-3 gap-3">
              <Field label="Bulan pertama (pcs)">
                <Input type="number" min={0} value={s.rampFrom ?? 0} onChange={(e) => upd({ rampFrom: Number(e.target.value) })} />
              </Field>
              <Field label="Target (pcs)">
                <Input type="number" min={0} value={s.rampTo ?? 0} onChange={(e) => upd({ rampTo: Number(e.target.value) })} />
              </Field>
              <Field label="Tercapai di bulan ke-">
                <Input type="number" min={1} max={s.months} value={s.rampMonths ?? 1} onChange={(e) => upd({ rampMonths: Math.min(s.months, Math.max(1, Number(e.target.value) || 1)) })} />
              </Field>
            </div>
          )}
          {s.volumeMode === 'manual' ? (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
              {months.map((m) => (
                <Field key={m} label={monthLabel(m)}>
                  <Input type="number" min={0} className="text-right" value={s.volume[m] ?? 0} onChange={(e) => upd({ volume: { ...s.volume, [m]: Number(e.target.value) } })} />
                </Field>
              ))}
            </div>
          ) : (
            <MonthChips months={months} value={(m) => s.volume[m] ?? 0} />
          )}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="3 · Restock"
          subtitle={`${int(s.restocks.reduce((a, x) => a + x.pcs, 0))} pcs · ${rp(s.restocks.reduce((a, x) => a + x.pcs * x.costPerPcs, 0), { compact: true })} selama periode`}
          actions={
            <Tabs
              value={s.restockMode ?? 'manual'}
              onChange={setRestockMode}
              items={[
                { value: 'routine', label: 'Rutin' },
                { value: 'match', label: 'Ikuti penjualan' },
                { value: 'manual', label: 'Rinci per SKU' },
              ]}
            />
          }
        >
          {s.restockMode === 'routine' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Pcs tiap restock">
                <Input type="number" min={0} value={s.restockPcs ?? 0} onChange={(e) => upd({ restockPcs: Number(e.target.value) })} />
              </Field>
              <Field label="Restock setiap (bulan)">
                <Input type="number" min={1} max={12} value={s.restockEvery ?? 1} onChange={(e) => upd({ restockEvery: Math.max(1, Number(e.target.value) || 1) })} />
              </Field>
              <Field label="Mulai bulan">
                <Input type="month" value={s.restockFrom && s.restockFrom > s.start ? s.restockFrom : s.start} onChange={(e) => upd({ restockFrom: e.target.value || undefined })} />
              </Field>
              <Field label="Biaya per pcs (Rp)" hint={`HPP: ${rp(s.landedCost)}`}>
                <Input type="number" min={0} value={s.restockCost ?? s.landedCost} onChange={(e) => upd({ restockCost: Number(e.target.value) })} />
              </Field>
            </div>
          )}
          {s.restockMode === 'match' && (
            <Field label="Biaya per pcs (Rp)" hint="Tiap bulan restock sebanyak yang terjual di bulan itu, sehingga stok awal tetap utuh">
              <Input type="number" min={0} value={s.restockCost ?? s.landedCost} onChange={(e) => upd({ restockCost: Number(e.target.value) })} />
            </Field>
          )}
          {s.restockMode === 'manual' ? (
            <RestockPlan items={s.restocks} months={months} stock={stock ?? []} fallbackCost={s.landedCost} onChange={(restocks) => upd({ restocks })} />
          ) : (
            <MonthChips months={months} value={(m) => s.restocks.filter((x) => x.month === m).reduce((a, x) => a + x.pcs, 0)} />
          )}
        </Card>

        <Card title="4 · Biaya tetap bulanan" subtitle="Gaji, sewa, listrik, iklan rutin">
          <Rows<CostItem>
            items={s.costs}
            onChange={(costs) => upd({ costs })}
            make={() => ({ id: uid(), name: 'Biaya baru', amount: 0, from: s.start })}
            fields={[
              { key: 'name', label: 'Nama', type: 'text', wide: true },
              { key: 'amount', label: 'Rp / bulan', type: 'number' },
              { key: 'from', label: 'Mulai', type: 'month' },
              { key: 'to', label: 'Selesai (opsional)', type: 'month' },
            ]}
          />
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="5 · Kas lain di tengah periode"
          subtitle="Opsional: pelunasan sewa, beli alat, tambahan modal susulan"
          actions={
            <Button icon="plus" onClick={() => upd({ oneOffs: [...s.oneOffs, { id: uid(), name: 'Pengeluaran', month: s.start, amount: 0 }] })}>
              Tambah
            </Button>
          }
        >
          <div className="flex flex-col gap-3">
            {!s.oneOffs.length && <p className="text-[13.5px] text-muted">Belum ada.</p>}
            {s.oneOffs.map((o) => (
              <div key={o.id} className="grid grid-cols-2 items-end gap-2 rounded-xl border border-line-soft p-3">
                <label>
                  <span className="mb-1 block text-[12px] text-muted">Nama</span>
                  <Input className="h-9" value={o.name} onChange={(e) => setOneOff(o.id, { name: e.target.value })} />
                </label>
                <label>
                  <span className="mb-1 block text-[12px] text-muted">Bulan</span>
                  <Input className="h-9" type="month" value={o.month} onChange={(e) => e.target.value && setOneOff(o.id, { month: e.target.value })} />
                </label>
                <label>
                  <span className="mb-1 block text-[12px] text-muted">Jenis</span>
                  <Select
                    className="h-9"
                    value={o.amount < 0 ? 'in' : 'out'}
                    onChange={(e) => setOneOff(o.id, { amount: Math.abs(o.amount) * (e.target.value === 'in' ? -1 : 1) })}
                    options={[
                      { value: 'out', label: 'Uang keluar' },
                      { value: 'in', label: 'Uang masuk' },
                    ]}
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[12px] text-muted">Rp · {rp(Math.abs(o.amount), { compact: true })}</span>
                  <Input className="h-9 text-right" type="number" min={0} value={Math.abs(o.amount)} onChange={(e) => setOneOff(o.id, { amount: Math.abs(Number(e.target.value)) * (o.amount < 0 ? -1 : 1) })} />
                </label>
                <div className="col-span-2 -mb-1 flex justify-end">
                  <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => upd({ oneOffs: s.oneOffs.filter((x) => x.id !== o.id) })} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="6 · Angka per pcs" subtitle="Terisi otomatis dari data; ubah bila perlu">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Stok awal (pcs)" hint={`Data: ${int(base.openingStock)} pcs`}>
              <Input type="number" value={s.openingStock} onChange={(e) => upd({ openingStock: Number(e.target.value) })} />
            </Field>
            <Field label="Harga jual rata-rata (Rp)" hint={`Data: ${rp(base.avgPrice)}`}>
              <Input type="number" value={s.price} onChange={(e) => upd({ price: Number(e.target.value) })} />
            </Field>
            <Field label="HPP / landed cost (Rp)" hint={`Data: ${rp(base.landedCost)}`}>
              <Input type="number" value={s.landedCost} onChange={(e) => upd({ landedCost: Number(e.target.value) })} />
            </Field>
            <Field label="Potongan TikTok (% omzet)" hint={base.feeSource === 'settlement' ? 'Dari laporan settlement' : 'Komisi platform + dinamis'}>
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
                <th className={`${th} text-right`}>Kas lain</th>
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
            Arus kas = dana cair TikTok − komisi tim − biaya tetap − kas lain − restock. Laba operasional memakai HPP (stok lama yang terjual), sehingga bisa berbeda dari arus kas.
            Belum termasuk gaji owner & pajak.
          </p>
        </Card>
      </div>
    </>
  )
}

function RestockPlan({ items, months, stock, fallbackCost, onChange }: { items: Restock[]; months: string[]; stock: StockRow[]; fallbackCost: number; onChange: (v: Restock[]) => void }) {
  const skus = stock.filter((r) => r.tracked && r.category !== 'Kemasan')
  const bySku = new Map(skus.map((r) => [r.sku, r]))
  const options = [
    { value: '', label: 'Umum (tanpa rincian SKU)' },
    ...skus.map((r) => ({ value: r.sku, label: `${r.product_code} · ${r.product_name} · ${r.color} (sisa ${int(Math.max(0, r.onHand))})` })),
  ]
  const costOf = (sku?: string) => Math.round((sku && bySku.get(sku)?.landed) || fallbackCost)
  const used = [...new Set(items.map((x) => x.month))].filter((m) => months.includes(m)).sort()
  const outside = items.filter((x) => !months.includes(x.month))
  const set = (id: string, patch: Partial<Restock>) => onChange(items.map((x) => (x.id === id ? { ...x, ...patch } : x)))
  const addLine = (month: string) => onChange([...items, { id: uid(), month, pcs: 0, costPerPcs: costOf() }])
  const nextMonth = months.find((m) => !used.includes(m))
  const copyTo = (from: string, to: string) => onChange([...items, ...items.filter((x) => x.month === from).map((x) => ({ ...x, id: uid(), month: to }))])
  return (
    <div className="flex flex-col gap-3">
      {!used.length && <p className="text-[13.5px] text-muted">Belum ada rencana restock.</p>}
      {used.map((m) => {
        const lines = items.filter((x) => x.month === m)
        const after = months[months.indexOf(m) + 1]
        return (
          <div key={m} className="overflow-hidden rounded-2xl border border-line-soft">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-canvas/70 px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <Input
                  aria-label="Bulan restock"
                  className="h-8 w-[158px] text-[13px] font-semibold"
                  type="month"
                  min={months[0]}
                  max={months[months.length - 1]}
                  value={m}
                  onChange={(e) => e.target.value && onChange(items.map((x) => (x.month === m ? { ...x, month: e.target.value } : x)))}
                />
                <span className="num text-[13px] text-muted">
                  {int(lines.reduce((a, x) => a + x.pcs, 0))} pcs · {rp(lines.reduce((a, x) => a + x.pcs * x.costPerPcs, 0), { compact: true })}
                </span>
              </div>
              <div className="flex items-center gap-1">
                {after && !used.includes(after) && (
                  <button type="button" className="rounded-full px-2.5 py-1 text-[12.5px] font-medium text-ink-2 hover:bg-white hover:text-navy" onClick={() => copyTo(m, after)}>
                    Salin ke {monthLabel(after)}
                  </button>
                )}
                <IconButton icon="trash" label={`Hapus restock ${monthLabel(m, true)}`} tone="danger" onClick={() => onChange(items.filter((x) => x.month !== m))} />
              </div>
            </div>
            <div className="flex flex-col gap-2 p-3">
              {lines.map((x) => (
                <div key={x.id} className="grid grid-cols-[1fr_32px] items-end gap-2 sm:grid-cols-[1fr_84px_120px_32px]">
                  <label className="min-w-0">
                    <span className="mb-1 block text-[12px] text-muted">Produk</span>
                    <Select className="h-9" value={x.sku ?? ''} options={options} onChange={(e) => set(x.id, { sku: e.target.value || undefined, costPerPcs: costOf(e.target.value) })} />
                  </label>
                  <label className="col-start-1 sm:col-start-auto">
                    <span className="mb-1 block text-[12px] text-muted">Pcs</span>
                    <Input className="h-9 text-right" type="number" min={0} value={x.pcs} onChange={(e) => set(x.id, { pcs: Math.max(0, Number(e.target.value)) })} />
                  </label>
                  <label className="col-start-1 sm:col-start-auto">
                    <span className="mb-1 block text-[12px] text-muted">Biaya/pcs (Rp)</span>
                    <Input className="h-9 text-right" type="number" min={0} value={x.costPerPcs} onChange={(e) => set(x.id, { costPerPcs: Math.max(0, Number(e.target.value)) })} />
                  </label>
                  <div className="col-start-2 row-start-1 sm:col-start-auto sm:row-start-auto">
                    <IconButton icon="trash" label="Hapus baris" tone="danger" onClick={() => onChange(items.filter((y) => y.id !== x.id))} />
                  </div>
                </div>
              ))}
              <div>
                <Button icon="plus" onClick={() => addLine(m)}>
                  Tambah SKU
                </Button>
              </div>
            </div>
          </div>
        )
      })}
      {outside.length > 0 && (
        <p className="text-[12.5px] text-warn">
          {outside.length} baris restock berada di luar periode proyeksi dan tidak dihitung.{' '}
          <button type="button" className="font-medium underline" onClick={() => onChange(items.filter((x) => months.includes(x.month)))}>
            Hapus
          </button>
        </p>
      )}
      {nextMonth && (
        <div>
          <Button icon="plus" onClick={() => addLine(nextMonth)}>
            Tambah bulan restock ({monthLabel(nextMonth)})
          </Button>
        </div>
      )}
    </div>
  )
}

function MonthChips({ months, value }: { months: string[]; value: (m: string) => number }) {
  return (
    <div className="mt-4 flex flex-wrap gap-1.5">
      {months.map((m) => (
        <span key={m} className={`rounded-lg px-2.5 py-1 text-[12.5px] ${value(m) ? 'bg-canvas text-ink-2' : 'bg-canvas/50 text-muted'}`}>
          {monthLabel(m)} <b className="num font-semibold text-ink">{value(m) ? int(value(m)) : '–'}</b>
        </span>
      ))}
    </div>
  )
}

type FieldDef<T> = { key: keyof T & string; label: string; type: 'text' | 'number' | 'month'; wide?: boolean }
function Rows<T extends { id: string }>({ items, onChange, make, fields }: { items: T[]; onChange: (v: T[]) => void; make: () => T; fields: FieldDef<T>[] }) {
  const set = (id: string, k: keyof T, v: unknown) => onChange(items.map((x) => (x.id === id ? { ...x, [k]: v } : x)))
  return (
    <div className="flex flex-col gap-2">
      {!items.length && <p className="text-[13.5px] text-muted">Belum ada.</p>}
      {items.map((it) => (
        <div key={it.id} className="flex flex-wrap items-end gap-2 rounded-xl border border-line-soft p-3">
          {fields.map((f) => (
            <label key={f.key} className={f.wide ? 'basis-full' : 'min-w-[110px] flex-1'}>
              <span className="mb-1 block text-[12px] text-muted">{f.label}</span>
              <Input
                className="h-9"
                type={f.type}
                value={(it[f.key] as unknown as string | number | undefined) ?? ''}
                onChange={(e) => set(it.id, f.key, f.type === 'number' ? Number(e.target.value) : e.target.value || undefined)}
              />
            </label>
          ))}
          <IconButton icon="trash" label="Hapus" tone="danger" onClick={() => onChange(items.filter((x) => x.id !== it.id))} />
        </div>
      ))}
      <div>
        <Button icon="plus" onClick={() => onChange([...items, make()])}>
          Tambah
        </Button>
      </div>
    </div>
  )
}
