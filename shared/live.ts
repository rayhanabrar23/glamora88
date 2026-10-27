// Analisis sesi live: penjualan dihitung otomatis dari order yang masuk selama sesi berlangsung.
import type { Sale } from './types'

export interface LiveSession {
  id: number
  start_at: string
  duration_min: number
  store: string
  host: string | null
  title: string | null
  viewers: number | null
  notes: string | null
}

export interface LiveSessionResult extends LiveSession {
  end_at: string
  orders: number
  pcs: number
  omzet: number
  pcsPerHour: number
  omzetPerHour: number
}

export interface HostSummary {
  host: string
  sessions: number
  hours: number
  pcs: number
  omzet: number
  pcsPerHour: number
  omzetPerHour: number
  zeroSessions: number
}

export interface BucketRow {
  key: string
  label: string
  sessions: number
  hours: number
  omzet: number
  omzetPerHour: number
}

export interface SuggestedSession {
  store: string
  start_at: string
  duration_min: number
  orders: number
  pcs: number
  omzet: number
}

export interface LiveReport {
  sessions: LiveSessionResult[]
  hosts: HostSummary[]
  byWeekday: BucketRow[]
  byHour: BucketRow[]
  totals: { sessions: number; hours: number; pcs: number; omzet: number; liveShare: number; daysWithLive: number; daysInRange: number }
  suggestions: SuggestedSession[]
}

const pad = (n: number) => String(n).padStart(2, '0')
/** 'YYYY-MM-DD HH:MM:SS' → menit (zona waktu diabaikan, semua waktu lokal toko). */
export const toMin = (s: string) => {
  const [d, t = '00:00:00'] = s.split(' ')
  const [y, m, dd] = d.split('-').map(Number)
  const [hh, mm] = t.split(':').map(Number)
  return Date.UTC(y, m - 1, dd, hh, mm) / 60000
}
export const fromMin = (min: number) => {
  const d = new Date(min * 60000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:00`
}

const DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu']
const net = (s: Sale) => s.qty - s.return_qty - s.cancel_qty

export function buildLiveReport(sessionsIn: LiveSession[], salesIn: Sale[], bufferMin = 15, from?: string, to?: string): LiveReport {
  const inRange = (d: string) => (!from || d.slice(0, 7) >= from) && (!to || d.slice(0, 7) <= to)
  const sessions = sessionsIn.filter((s) => inRange(s.start_at)).sort((a, b) => b.start_at.localeCompare(a.start_at))
  const sales = salesIn.filter((s) => inRange(s.order_date) && net(s) > 0)

  // Indeks penjualan per toko, urut waktu
  const byStore = new Map<string, { t: number; s: Sale }[]>()
  for (const s of sales) {
    const arr = byStore.get(s.store) ?? []
    arr.push({ t: toMin(s.order_date), s })
    byStore.set(s.store, arr)
  }
  for (const arr of byStore.values()) arr.sort((a, b) => a.t - b.t)

  const attributed = new Set<Sale>()
  const results: LiveSessionResult[] = sessions.map((ss) => {
    const start = toMin(ss.start_at)
    const end = start + ss.duration_min
    const rows = (byStore.get(ss.store) ?? []).filter((x) => x.t >= start && x.t <= end + bufferMin)
    const orders = new Set<string>()
    let pcs = 0
    let omzet = 0
    for (const { s } of rows) {
      attributed.add(s)
      orders.add(s.order_id)
      pcs += net(s)
      omzet += net(s) * s.unit_price
    }
    const hours = Math.max(ss.duration_min, 1) / 60
    return { ...ss, end_at: fromMin(end), orders: orders.size, pcs, omzet, pcsPerHour: pcs / hours, omzetPerHour: omzet / hours }
  })

  // Per host
  const hostMap = new Map<string, HostSummary>()
  for (const r of results) {
    const h = r.host?.trim() || 'Tanpa host'
    const x = hostMap.get(h) ?? { host: h, sessions: 0, hours: 0, pcs: 0, omzet: 0, pcsPerHour: 0, omzetPerHour: 0, zeroSessions: 0 }
    x.sessions++
    x.hours += r.duration_min / 60
    x.pcs += r.pcs
    x.omzet += r.omzet
    if (r.pcs === 0) x.zeroSessions++
    hostMap.set(h, x)
  }
  const hosts = [...hostMap.values()]
    .map((h) => ({ ...h, pcsPerHour: h.hours ? h.pcs / h.hours : 0, omzetPerHour: h.hours ? h.omzet / h.hours : 0 }))
    .sort((a, b) => b.omzetPerHour - a.omzetPerHour)

  const bucket = (keyOf: (r: LiveSessionResult) => string, labelOf: (k: string) => string, keys: string[]) => {
    const m = new Map<string, BucketRow>(keys.map((k) => [k, { key: k, label: labelOf(k), sessions: 0, hours: 0, omzet: 0, omzetPerHour: 0 }]))
    for (const r of results) {
      const b = m.get(keyOf(r))
      if (!b) continue
      b.sessions++
      b.hours += r.duration_min / 60
      b.omzet += r.omzet
    }
    return [...m.values()].map((b) => ({ ...b, omzetPerHour: b.hours ? b.omzet / b.hours : 0 }))
  }
  const weekday = (s: string) => String(new Date(toMin(s) * 60000).getUTCDay())
  const byWeekday = bucket((r) => weekday(r.start_at), (k) => DAYS[Number(k)], ['1', '2', '3', '4', '5', '6', '0'])
  const hourBlock = (s: string) => {
    const h = Number(s.slice(11, 13))
    return h < 12 ? 'pagi' : h < 15 ? 'siang' : h < 18 ? 'sore' : h < 21 ? 'malam' : 'larut'
  }
  const HOUR_LABEL: Record<string, string> = {
    pagi: 'Pagi (sebelum 12.00)',
    siang: 'Siang (12–15)',
    sore: 'Sore (15–18)',
    malam: 'Malam (18–21)',
    larut: 'Larut (21 ke atas)',
  }
  const byHour = bucket((r) => hourBlock(r.start_at), (k) => HOUR_LABEL[k], ['pagi', 'siang', 'sore', 'malam', 'larut'])

  // Usulan sesi dari pola order yang belum tercakup sesi mana pun
  const suggestions: SuggestedSession[] = []
  const GAP = 45
  for (const [store, arr] of byStore) {
    const free = arr.filter((x) => !attributed.has(x.s))
    let cluster: typeof free = []
    const flush = () => {
      const orders = new Set(cluster.map((c) => c.s.order_id))
      if (orders.size >= 3) {
        const start = cluster[0].t - 10
        const end = cluster[cluster.length - 1].t
        suggestions.push({
          store,
          start_at: fromMin(start),
          duration_min: Math.max(30, Math.ceil((end - start) / 15) * 15),
          orders: orders.size,
          pcs: cluster.reduce((a, c) => a + net(c.s), 0),
          omzet: cluster.reduce((a, c) => a + net(c.s) * c.s.unit_price, 0),
        })
      }
      cluster = []
    }
    for (const x of free) {
      if (cluster.length && x.t - cluster[cluster.length - 1].t > GAP) flush()
      cluster.push(x)
    }
    if (cluster.length) flush()
  }
  suggestions.sort((a, b) => b.start_at.localeCompare(a.start_at))

  const days = new Set(results.map((r) => r.start_at.slice(0, 10)))
  const dates = sales.map((s) => s.order_date.slice(0, 10)).concat(results.map((r) => r.start_at.slice(0, 10))).sort()
  const daysInRange = dates.length ? Math.round((toMin(`${dates[dates.length - 1]} 00:00:00`) - toMin(`${dates[0]} 00:00:00`)) / 1440) + 1 : 0
  const totalOmzet = sales.reduce((a, s) => a + net(s) * s.unit_price, 0)
  const liveOmzet = results.reduce((a, r) => a + r.omzet, 0)
  return {
    sessions: results,
    hosts,
    byWeekday,
    byHour,
    totals: {
      sessions: results.length,
      hours: results.reduce((a, r) => a + r.duration_min / 60, 0),
      pcs: results.reduce((a, r) => a + r.pcs, 0),
      omzet: liveOmzet,
      liveShare: totalOmzet ? liveOmzet / totalOmzet : 0,
      daysWithLive: days.size,
      daysInRange,
    },
    suggestions,
  }
}
