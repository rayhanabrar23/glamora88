import { useState } from 'react'
import type { DashboardData } from '../../shared/dashboard'
import { qs } from '../lib/api'
import { int, monthLabel, pct, rp } from '../lib/format'
import { useData } from '../lib/useData'
import { CashChart, ModelBars, MonthlyStoreChart, ProfitChart } from '../components/charts'
import { Icon } from '../components/Icon'
import { Badge, Callout, Card, Empty, ErrorBox, Input, Loading, PageHeader, Select, Stat, Table, Tabs, td, tdNum, th } from '../components/ui'
import { Link } from 'react-router-dom'

export default function Dashboard() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [store, setStore] = useState('')
  const { data, error, loading, reload } = useData<DashboardData>(`/dashboard${qs({ from, to, store })}`)

  const filters = (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
      <label className="text-[12px] text-muted">
        Dari
        <Input type="month" value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 h-9 w-full sm:w-[150px]" />
      </label>
      <label className="text-[12px] text-muted">
        Sampai
        <Input type="month" value={to} onChange={(e) => setTo(e.target.value)} className="mt-1 h-9 w-full sm:w-[150px]" />
      </label>
      <label className="col-span-2 text-[12px] text-muted">
        Toko
        <Select
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="mt-1 h-9 w-full sm:w-[170px]"
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
  const hour = new Date().getHours()
  const greet = hour < 11 ? 'Selamat pagi' : hour < 15 ? 'Selamat siang' : hour < 18 ? 'Selamat sore' : 'Selamat malam'
  const need = data.insights.filter((i) => i.tone === 'warning' || i.tone === 'critical')
  return (
    <div className={loading ? 'opacity-70 transition-opacity' : ''}>
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[12px] font-semibold tracking-[0.16em] text-[#d9bd86] uppercase">Ringkasan Kinerja</div>
          <h1 className="mt-1 text-[30px] leading-tight font-semibold tracking-tight text-white">{greet}, tim Glamora</h1>
          <p className="mt-1 text-[14.5px] text-white/65">
            {periodText} · {data.period.months} bulan{store ? ` · ${store}` : ''}
          </p>
        </div>
        <div className="glass rounded-[22px] px-4 py-3">{filters}</div>
      </div>

      <div className="stagger grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Hero data={data} />
        <Card title="Posisi terhadap titik impas">
          <BepBlock data={data} />
        </Card>
      </div>

      <div className="stagger mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon="coins" label="Omzet neto" value={rp(k.omzetNet, { compact: true })} hint={`Rata-rata ${rp(b.actualOmzetPerMonth, { compact: true })} per bulan`} />
        <Stat icon="sales" label="Produk terjual" value={`${int(k.pcsNet)} pcs`} hint={`${int(k.orders)} pesanan · harga rata-rata ${rp(k.avgPrice, { compact: true })}`} />
        <Stat
          icon={k.operatingProfit >= 0 ? 'up' : 'down'}
          label="Laba (rugi) operasional"
          value={rp(k.operatingProfit, { compact: true })}
          tone={k.operatingProfit >= 0 ? 'good' : 'bad'}
          hint={`Margin kontribusi ${pct(k.contributionPct)}`}
        />
        <Stat icon="product" label="Nilai stok di gudang" value={rp(k.stockValue, { compact: true })} hint={`${int(k.stockUnits)} pcs · tingkat retur ${pct(k.returnRate)}`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <StockPulse data={data} />
        <Card
          title={
            <span className="flex items-center gap-2">
              Catatan otomatis
              {need.length > 0 && <span className="num rounded-full bg-bad-soft px-2 py-0.5 text-[11.5px] font-semibold text-bad">{need.length} perlu perhatian</span>}
            </span>
          }
        >
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
          <Link to="/proyeksi" className="mt-4 flex h-11 items-center justify-center gap-2 btn-gold rounded-full text-[14px] font-semibold text-navy">
            Buka proyeksi kas <Icon name="arrow" size={15} />
          </Link>
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
        <MonthlyTable data={data} />
      </div>
    </div>
  )
}

function Hero({ data }: { data: DashboardData }) {
  const k = data.kpi
  const rows = data.monthly.slice(-12)
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.operatingProfit)))
  const last = rows[rows.length - 1]
  const profit = k.operatingProfit >= 0
  return (
    <section className="hero relative overflow-hidden rounded-3xl p-6 text-white sm:p-7">
      <div className="flex items-center gap-2 text-[12.5px] font-medium text-white/70">
        <span className={`h-2 w-2 rounded-full ${profit ? 'bg-[#6fd3a4]' : 'bg-[#ff9d92]'}`} />
        Laba (rugi) operasional periode ini
      </div>
      <div className="num mt-2 text-[40px] leading-none font-semibold tracking-tight sm:text-[46px]">{rp(k.operatingProfit, { compact: true })}</div>
      <p className="mt-2 max-w-md text-[14px] leading-relaxed text-white/75">
        Omzet neto {rp(k.omzetNet, { compact: true })} dari {int(k.pcsNet)} pcs, margin kontribusi {pct(k.contributionPct)}.
      </p>
      <div className="mt-5 flex flex-wrap gap-2 text-[12.5px]">
        <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur">
          Boost <b className="num font-semibold">{rp(k.boostSpend, { compact: true })}</b>
        </span>
        {last && (
          <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1.5 backdrop-blur">
            {monthLabel(last.month, true)} <b className={`num font-semibold ${last.operatingProfit >= 0 ? 'text-[#8fe0b8]' : 'text-[#ffb1a8]'}`}>{rp(last.operatingProfit, { compact: true })}</b>
          </span>
        )}
      </div>
      <div className="mt-6 flex h-[72px] items-end gap-1.5" aria-hidden="true">
        {rows.map((r) => (
          <div key={r.month} className="flex h-full flex-1 flex-col justify-end" title={`${monthLabel(r.month, true)}: ${rp(r.operatingProfit)}`}>
            <div
              className={`rounded-t-md rounded-b-sm ${r.operatingProfit >= 0 ? 'bg-gradient-to-t from-[#b08d57] to-[#e6cf9f]' : 'bg-white/25'}`}
              style={{ height: `${Math.max(6, (Math.abs(r.operatingProfit) / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-[11px] text-white/50">
        <span>{rows[0] && monthLabel(rows[0].month, true)}</span>
        <span>Emas = laba · abu = rugi</span>
        <span>{last && monthLabel(last.month, true)}</span>
      </div>
    </section>
  )
}

function Gauge({ value }: { value: number }) {
  // busur setengah lingkaran; skala 0–120% dengan penanda titik impas di 100%
  const R = 80
  const len = Math.PI * R
  const p = Math.max(0, Math.min(1.2, value)) / 1.2
  const color = value >= 1 ? 'var(--color-good)' : value >= 0.7 ? 'var(--color-warn)' : 'var(--color-bad)'
  const ang = Math.PI * (1 - 1 / 1.2)
  const mx = 100 + Math.cos(ang) * R
  const my = 96 - Math.sin(ang) * R
  return (
    <svg viewBox="0 0 200 112" className="w-full max-w-[250px]" role="img" aria-label={`${Math.round(value * 100)}% dari titik impas`}>
      <path d="M20 96 A80 80 0 0 1 180 96" fill="none" stroke="var(--color-line-soft)" strokeWidth="14" strokeLinecap="round" />
      <path d="M20 96 A80 80 0 0 1 180 96" fill="none" stroke={color} strokeWidth="14" strokeLinecap="round" strokeDasharray={`${len * p} ${len}`} style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.2,0.7,0.2,1)' }} />
      <circle cx={mx} cy={my} r="5" fill="#fff" stroke="var(--color-ink)" strokeWidth="2.5" />
      <text x="100" y="86" textAnchor="middle" className="num" style={{ fontSize: 34, fontWeight: 600, fill: 'var(--color-ink)', letterSpacing: '-0.02em' }}>
        {Math.round(value * 100)}%
      </text>
      <text x="100" y="106" textAnchor="middle" style={{ fontSize: 11.5, fill: 'var(--color-muted)' }}>
        dari titik impas
      </text>
    </svg>
  )
}

function BepBlock({ data }: { data: DashboardData }) {
  const b = data.bep
  return (
    <div>
      <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
        <Gauge value={b.progress ?? 0} />
        <dl className="grid w-full grid-cols-2 gap-x-5 gap-y-3 text-[13.5px] sm:grid-cols-1">
          <div>
            <dt className="text-muted">Rata-rata omzet</dt>
            <dd className="num font-semibold text-ink">{rp(b.actualOmzetPerMonth, { compact: true })} / bulan</dd>
          </div>
          <div>
            <dt className="text-muted">Titik impas</dt>
            <dd className="num font-semibold text-ink">
              {rp(b.bepOmzet, { compact: true })} <span className="font-normal text-muted">(±{int(b.bepPcs)} pcs)</span>
            </dd>
          </div>
          <div>
            <dt className="text-muted">Biaya tetap rata-rata</dt>
            <dd className="num font-medium text-ink">{rp(b.fixedPerMonth)} / bulan</dd>
          </div>
          <div>
            <dt className="text-muted">Margin kontribusi</dt>
            <dd className="num font-medium text-ink">{pct(b.contributionPct)} dari omzet</dd>
          </div>
        </dl>
      </div>
      {b.plannedFixed && (
        <div className="mt-4 rounded-2xl bg-gold-soft px-4 py-3">
          <div className="text-[13px] font-medium text-[#7a5c2b]">Rencana biaya tetap {rp(b.plannedFixed, { compact: true })}/bulan</div>
          <div className="num mt-0.5 text-[13.5px] text-ink">
            Titik impas <b>{rp(b.plannedBepOmzet, { compact: true })}</b> · <b>±{int(b.plannedBepPcs)} pcs</b>/bulan
          </div>
        </div>
      )}
    </div>
  )
}

function StockPulse({ data }: { data: DashboardData }) {
  const months = data.period.activeMonths || 1
  const rows = data.stockByModel.filter((s) => s.onHand > 0 || s.soldNet > 0)
  return (
    <Card title="Stok per model" subtitle="Terjual dibanding total yang pernah masuk" padded={false}>
      <Table
        head={
          <tr>
            <th className={th}>Model</th>
            <th className={`${th} text-right`}>Terjual</th>
            <th className={`${th} text-right`}>Sisa</th>
            <th className={`${th} w-[30%]`}>Terjual dari total</th>
            <th className={th}>Status</th>
          </tr>
        }
      >
        {rows.map((s) => {
          const sold = Math.max(0, s.soldNet)
          const left = Math.max(0, s.onHand)
          const share = sold + left > 0 ? sold / (sold + left) : 0
          const cover = sold > 0 ? left / (sold / months) : Infinity
          const [tone, label] =
            s.onHand <= 0 ? (['bad', 'Habis'] as const) : sold <= 0 ? (['warn', 'Belum laku'] as const) : cover < 1 ? (['warn', 'Menipis'] as const) : cover > 6 ? (['neutral', 'Lambat'] as const) : (['good', 'Aman'] as const)
          return (
            <tr key={s.code}>
              <td className={td}>
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gold-soft text-[11px] font-semibold text-[#7a5c2b]">{s.code.replace(/^GL-?/, '')}</span>
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{s.name}</div>
                    <div className="text-[12px] text-muted">{s.code}{s.inTransit > 0 ? ` · ${int(s.inTransit)} pcs dalam perjalanan` : ''}</div>
                  </div>
                </div>
              </td>
              <td className={tdNum}>{int(sold)}</td>
              <td className={`${tdNum} font-medium`}>{int(s.onHand)}</td>
              <td className={td}>
                <div className="flex items-center gap-2.5">
                  <div className="h-2 flex-1 rounded-full bg-line-soft">
                    <div className="h-2 rounded-full bg-navy" style={{ width: `${share * 100}%` }} />
                  </div>
                  <span className="num w-9 text-right text-[12.5px] text-ink-2">{pct(share, 0)}</span>
                </div>
              </td>
              <td className={td}>
                <Badge tone={tone}>{label}</Badge>
              </td>
            </tr>
          )
        })}
      </Table>
    </Card>
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
