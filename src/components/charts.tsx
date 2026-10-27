import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { monthLabel, rp, int } from '../lib/format'

export const SERIES = ['#2f5aa8', '#b97a1f', '#2e9a7a', '#7a5cc7', '#d1607f']
const GRID = '#efebe4'
const AXIS = { fontSize: 12, fill: '#7b8291' }
const POS = '#2f5aa8'
const NEG = '#b23a3a'

type TipItem = { name?: string; value?: number; color?: string; payload?: Record<string, unknown> }
function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; color?: string }[] }) {
  return (
    <div className="min-w-[180px] rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[13px] shadow-lg">
      <div className="mb-1.5 font-semibold text-ink">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="flex items-center justify-between gap-4 py-0.5">
          <span className="flex items-center gap-2 text-ink-2">
            {r.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: r.color }} />}
            {r.label}
          </span>
          <span className="num font-medium text-ink">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

const compactAxis = (v: number) => (v === 0 ? '0' : rp(v, { compact: true }).replace('Rp', ''))

export function MonthlyStoreChart({ data, stores }: { data: { month: string; omzetByStore: Record<string, number>; omzetNet: number }[]; stores: string[] }) {
  const rows = data.map((d) => ({ month: d.month, total: d.omzetNet, ...Object.fromEntries(stores.map((s) => [s, d.omzetByStore[s] ?? 0])) }))
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={compactAxis} tick={AXIS} axisLine={false} tickLine={false} width={56} />
        <Tooltip
          cursor={{ fill: 'rgba(176,141,87,0.08)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox
                title={monthLabel(String(label), true)}
                rows={[
                  ...(payload as unknown as TipItem[]).map((p) => ({ label: String(p.name), value: rp(p.value ?? 0), color: p.color })),
                  { label: 'Total', value: rp(Number((payload[0] as unknown as TipItem).payload?.total ?? 0)) },
                ]}
              />
            ) : null
          }
        />
        {stores.length > 1 && <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />}
        {stores.map((s, i) => (
          <Bar
            key={s}
            dataKey={s}
            stackId="a"
            fill={SERIES[i % SERIES.length]}
            stroke="#fff"
            strokeWidth={1}
            radius={i === stores.length - 1 ? [4, 4, 0, 0] : 0}
            maxBarSize={44}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ProfitChart({ data }: { data: { month: string; operatingProfit: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={compactAxis} tick={AXIS} axisLine={false} tickLine={false} width={56} />
        <ReferenceLine y={0} stroke="#b9b2a6" />
        <Tooltip
          cursor={{ fill: 'rgba(176,141,87,0.08)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox
                title={monthLabel(String(label), true)}
                rows={[{ label: Number(payload[0].value) >= 0 ? 'Laba operasional' : 'Rugi operasional', value: rp(Number(payload[0].value)) }]}
              />
            ) : null
          }
        />
        <Bar dataKey="operatingProfit" maxBarSize={40} radius={[4, 4, 4, 4]}>
          {data.map((d) => (
            <Cell key={d.month} fill={d.operatingProfit >= 0 ? POS : NEG} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

export function CashChart({ data }: { data: { month: string; cumulativeCash: number; netCash: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cashFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SERIES[0]} stopOpacity={0.18} />
            <stop offset="100%" stopColor={SERIES[0]} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={compactAxis} tick={AXIS} axisLine={false} tickLine={false} width={56} />
        <ReferenceLine y={0} stroke="#b9b2a6" />
        <Tooltip
          cursor={{ stroke: '#b08d57', strokeDasharray: '3 3' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox
                title={monthLabel(String(label), true)}
                rows={[
                  { label: 'Arus kas bulan ini', value: rp(Number((payload[0] as unknown as TipItem).payload?.netCash)) },
                  { label: 'Kumulatif', value: rp(Number(payload[0].value)) },
                ]}
              />
            ) : null
          }
        />
        <Area type="linear" dataKey="cumulativeCash" stroke={SERIES[0]} strokeWidth={2} fill="url(#cashFill)" dot={{ r: 3, fill: SERIES[0], stroke: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function ModelBars({ data }: { data: { label: string; value: number; sub?: string }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="flex flex-col gap-3">
      {data.map((d, i) => (
        <div key={d.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[13.5px]">
            <span className="truncate font-medium text-ink">{d.label}</span>
            <span className="num shrink-0 text-ink-2">{d.sub}</span>
          </div>
          <div className="h-2 rounded-full bg-line-soft">
            <div className="h-2 rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: i === 0 ? SERIES[0] : '#7f9bd0' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

export function StockBars({ data }: { data: { code: string; name: string; onHand: number; soldNet: number }[] }) {
  const rows = data.map((d) => ({ label: `${d.code} · ${d.name}`, Terjual: Math.max(0, d.soldNet), Sisa: Math.max(0, d.onHand) }))
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 34 + 40)}>
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke={GRID} />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="label" tick={{ ...AXIS, fill: '#4a5263' }} axisLine={false} tickLine={false} width={190} />
        <Tooltip
          cursor={{ fill: 'rgba(176,141,87,0.08)' }}
          content={({ active, payload, label }) =>
            active && payload?.length ? (
              <TipBox title={String(label)} rows={(payload as unknown as TipItem[]).map((p) => ({ label: String(p.name), value: `${int(p.value)} pcs`, color: p.color }))} />
            ) : null
          }
        />
        <Legend iconType="square" iconSize={10} wrapperStyle={{ fontSize: 13, paddingTop: 8 }} />
        <Bar dataKey="Terjual" stackId="s" fill={SERIES[0]} stroke="#fff" strokeWidth={1} />
        <Bar dataKey="Sisa" stackId="s" fill={SERIES[1]} stroke="#fff" strokeWidth={1} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}
