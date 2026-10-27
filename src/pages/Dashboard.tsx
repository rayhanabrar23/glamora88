import { useState } from 'react'
import type { DashboardData } from '../../shared/dashboard'
import { qs } from '../lib/api'
import { int, monthLabel, pct, rp } from '../lib/format'
import { useData } from '../lib/useData'
import { CashChart, ModelBars, MonthlyStoreChart, ProfitChart, StockBars } from '../components/charts'
import { Callout, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Stat, Table, Tabs, td, tdNum, th } from '../components/ui'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [store, setStore] = useState('')
  const { data, error, loading, reload } = useData<DashboardData>(`/dashboard${qs({ from, to, store })}`)

  const filters = (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-[12px] text-muted">
        Dari
        <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-[150px]" />
      </label>
      <label className="text-[12px] text-muted">
        Sampai
        <Input type="month" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-[150px]" />
      </label>
      <label className="text-[12px] text-muted">
        Toko
        <Select
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="mt-1 h-9 w-[170px]"
          options={[{ value: '', label: 'Semua toko' }, ...(data?.stores ?? []).map((s) => ({ value: s, label: s }))]}
        />
      </label>
    </div>
  )

  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />
  if (!data.monthly.length)
    return (
      <>
        <PageHeader title="Ringkasan" />
        <Empty title="Belum ada data">
          <Link className="text-navy underline" to="/penjualan">Unggah penjualan</Link> ·{' '}
          <Link className="text-navy underline" to="/pengaturan">Impor data</Link>
        </Empty>
      </>
    )

  const k = data.kpi
  const b = data.bep
  const periodText = `${monthLabel(data.period.from, true)} – ${monthLabel(data.period.to, true)}`
  return (
    <div className={loading ? 'opacity-70 transition-opacity' : ''}>
      <PageHeader title="Ringkasan Kinerja" subtitle={`${periodText} · ${data.period.months} bulan${store ? ` · ${store}` : ''}`} actions={filters} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Omzet neto" value={rp(k.omzetNet, { compact: true })} hint={`Rata-rata ${rp(b.actualOmzetPerMonth, { compact: true })} per bulan`} />
        <Stat label="Produk terjual" value={`${int(k.pcsNet)} pcs`} hint={`${int(k.orders)} pesanan · harga rata-rata ${rp(k.avgPrice, { compact: true })}`} />
        <Stat
          label="Laba (rugi) operasional"
          value={rp(k.operatingProfit, { compact: true })}
          tone={k.operatingProfit >= 0 ? 'good' : 'bad'}
          hint={`Margin kontribusi ${pct(k.contributionPct)}`}
        />
        <Stat label="Nilai stok di gudang" value={rp(k.stockValue, { compact: true })} hint={`${int(k.stockUnits)} pcs · tingkat retur ${pct(k.returnRate)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        <Card title="Posisi terhadap titik impas">
          <BepBlock data={data} />
        </Card>
        <Card title="Catatan otomatis">
          <div className="flex flex-col gap-2.5">
            {data.insights.length ? (
              data.insights.map((i) => (
                <Callout key={i.title} tone={i.tone} title={i.title}>
                  {i.detail}
                </Callout>
              ))
            ) : (
              <Callout tone="good" title="Tidak ada catatan" />
            )}
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Omzet neto per bulan">
          <MonthlyStoreChart data={data.monthly} stores={store ? [store] : data.stores} />
        </Card>
        <Card title="Laba (rugi) operasional per bulan">
          <ProfitChart data={data.monthly} />
        </Card>
        <Card title="Arus kas kumulatif">
          <CashChart data={data.monthly} />
        </Card>
        <Card title="Model terlaris">
          <ModelBars
            data={data.byModel.slice(0, 7).map((m) => ({ label: `${m.code} · ${m.name}`, value: m.omzetNet, sub: `${int(m.pcsNet)} pcs · ${rp(m.omzetNet, { compact: true })}` }))}
          />
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Stok per model">
          <StockBars data={data.stockByModel.filter((s) => s.onHand > 0 || s.soldNet > 0)} />
        </Card>
      </div>

      <div className="mt-4">
        <MonthlyTable data={data} />
      </div>
    </div>
  )
}

function BepBlock({ data }: { data: DashboardData }) {
  const b = data.bep
  const p = Math.min(1.2, b.progress ?? 0)
  const tone = (b.progress ?? 0) >= 1 ? 'bg-good' : (b.progress ?? 0) >= 0.7 ? 'bg-warn' : 'bg-bad'
  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="num text-[30px] font-semibold tracking-tight text-ink">{pct(b.progress, 0)}</div>
          <div className="text-[13px] text-muted">dari titik impas</div>
        </div>
        <div className="text-right text-[13px] text-ink-2">
          <div>
            Rata-rata omzet <span className="num font-semibold text-ink">{rp(b.actualOmzetPerMonth, { compact: true })}</span>
          </div>
          <div>
            Titik impas <span className="num font-semibold text-ink">{rp(b.bepOmzet, { compact: true })}</span> (±{int(b.bepPcs)} pcs)
          </div>
        </div>
      </div>
      <div className="relative mt-4 h-3 rounded-full bg-line-soft">
        <div className={`h-3 rounded-full ${tone}`} style={{ width: `${(p / 1.2) * 100}%` }} />
        <div className="absolute -top-1 h-5 w-[2px] bg-ink" style={{ left: `${(1 / 1.2) * 100}%` }} title="Titik impas" />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-[13.5px]">
        <div>
          <dt className="text-muted">Biaya tetap rata-rata</dt>
          <dd className="num font-medium text-ink">{rp(b.fixedPerMonth)} / bulan</dd>
        </div>
        <div>
          <dt className="text-muted">Margin kontribusi</dt>
          <dd className="num font-medium text-ink">{pct(b.contributionPct)} dari omzet</dd>
        </div>
        {b.plannedFixed && (
          <div className="col-span-2 rounded-xl bg-gold-soft px-4 py-3">
            <dt className="text-[13px] font-medium text-[#7a5c2b]">Rencana biaya tetap {rp(b.plannedFixed, { compact: true })}/bulan</dt>
            <dd className="num mt-0.5 text-ink">
              Titik impas <b>{rp(b.plannedBepOmzet, { compact: true })}</b> · <b>±{int(b.plannedBepPcs)} pcs</b>/bulan
            </dd>
          </div>
        )}
      </dl>
    </div>
  )
}

function MonthlyTable({ data }: { data: DashboardData }) {
  const [view, setView] = useState<'lr' | 'kas'>('lr')
  const rows = data.monthly
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0)
  return (
    <Card
      title="Tabel bulanan"
      actions={
        <Tabs
          value={view}
          onChange={setView}
          items={[
            { value: 'lr', label: 'Laba-rugi' },
            { value: 'kas', label: 'Arus kas' },
          ]}
        />
      }
      padded={false}
    >
      {view === 'lr' ? (
        <Table
          head={
            <tr>
              <th className={th}>Bulan</th>
              <th className={`${th} text-right`}>Pcs</th>
              <th className={`${th} text-right`}>Omzet neto</th>
              <th className={`${th} text-right`}>HPP</th>
              <th className={`${th} text-right`}>Potongan TikTok</th>
              <th className={`${th} text-right`}>Biaya operasional</th>
              <th className={`${th} text-right`}>Boost</th>
              <th className={`${th} text-right`}>Laba (rugi)</th>
            </tr>
          }
          footer={
            <tr>
              <td className={td}>Total</td>
              <td className={tdNum}>{int(sum((r) => r.pcsNet))}</td>
              <td className={tdNum}>{rp(sum((r) => r.omzetNet))}</td>
              <td className={tdNum}>{rp(sum((r) => r.hpp))}</td>
              <td className={tdNum}>{rp(sum((r) => r.platformFees))}</td>
              <td className={tdNum}>{rp(sum((r) => r.fixedCosts + r.variableExpenses))}</td>
              <td className={tdNum}>{rp(sum((r) => r.boost))}</td>
              <td className={`${tdNum} ${sum((r) => r.operatingProfit) < 0 ? 'text-bad' : 'text-good'}`}>{rp(sum((r) => r.operatingProfit))}</td>
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.month}>
              <td className={td}>{monthLabel(r.month, true)}</td>
              <td className={tdNum}>{int(r.pcsNet)}</td>
              <td className={tdNum}>{rp(r.omzetNet)}</td>
              <td className={tdNum}>{rp(r.hpp)}</td>
              <td className={tdNum}>{rp(r.platformFees)}</td>
              <td className={tdNum}>{rp(r.fixedCosts + r.variableExpenses)}</td>
              <td className={tdNum}>{rp(r.boost)}</td>
              <td className={`${tdNum} font-medium ${r.operatingProfit < 0 ? 'text-bad' : 'text-good'}`}>{rp(r.operatingProfit)}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Table
          head={
            <tr>
              <th className={th}>Bulan</th>
              <th className={`${th} text-right`}>Dana cair</th>
              <th className={`${th} text-right`}>Kas keluar operasional</th>
              <th className={`${th} text-right`}>Beli stok</th>
              <th className={`${th} text-right`}>Arus kas bersih</th>
              <th className={`${th} text-right`}>Kumulatif</th>
            </tr>
          }
        >
          {rows.map((r) => (
            <tr key={r.month}>
              <td className={td}>{monthLabel(r.month, true)}</td>
              <td className={tdNum}>{rp(r.cashIn)}</td>
              <td className={tdNum}>{rp(-r.cashOutOps)}</td>
              <td className={tdNum}>{rp(-r.cashPurchases)}</td>
              <td className={`${tdNum} ${r.netCash < 0 ? 'text-bad' : 'text-good'}`}>{rp(r.netCash)}</td>
              <td className={`${tdNum} font-medium`}>{rp(r.cumulativeCash)}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  )
}
