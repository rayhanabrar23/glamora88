// Agenda tim: kegiatan & pengingat, bisa berulang. Kejadian berulang dijabarkan per tanggal di sisi tampilan.
export type AgendaKind = 'kegiatan' | 'pengingat'
export type AgendaRepeat = 'none' | 'daily' | 'weekly' | 'monthly'

export interface AgendaItem {
  id: number
  title: string
  notes: string | null
  kind: AgendaKind
  category: string | null
  start_date: string // YYYY-MM-DD
  start_time: string | null // HH:MM
  end_date: string | null // kegiatan beberapa hari
  assignee: string | null // null = semua
  repeat: AgendaRepeat
  repeat_until: string | null
  /** tanggal kejadian yang sudah ditandai selesai (JSON array) */
  done: string | null
  created_by: string | null
  created_at: string
}

export interface AgendaOccurrence {
  item: AgendaItem
  date: string
  done: boolean
}

export const AGENDA_CATEGORIES = ['Live', 'Restock & impor', 'Admin & data', 'Keuangan', 'Konten & promo', 'Rapat', 'Lainnya']
export const REPEAT_LABEL: Record<AgendaRepeat, string> = { none: 'Tidak berulang', daily: 'Setiap hari', weekly: 'Setiap minggu', monthly: 'Setiap bulan' }

const DAY = 86400000
const toDay = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY)
const fromDay = (n: number) => new Date(n * DAY).toISOString().slice(0, 10)
export const doneList = (it: Pick<AgendaItem, 'done'>): string[] => {
  try {
    const v = JSON.parse(it.done ?? '[]')
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

/** Semua kejadian di rentang [from, to] (inklusif). Kegiatan beberapa hari muncul di tanggal mulainya saja. */
export function expandAgenda(items: AgendaItem[], from: string, to: string): AgendaOccurrence[] {
  const out: AgendaOccurrence[] = []
  const f = toDay(from)
  const t = toDay(to)
  for (const it of items) {
    const done = new Set(doneList(it))
    const s = toDay(it.start_date)
    const until = it.repeat_until ? Math.min(t, toDay(it.repeat_until)) : t
    const push = (d: number) => {
      const ds = fromDay(d)
      out.push({ item: it, date: ds, done: done.has(ds) })
    }
    if (it.repeat === 'none') {
      const e = it.end_date ? toDay(it.end_date) : s
      if (s <= t && e >= f) push(s)
      continue
    }
    if (it.repeat === 'daily' || it.repeat === 'weekly') {
      const step = it.repeat === 'daily' ? 1 : 7
      let d = s
      if (d < f) d = s + Math.ceil((f - s) / step) * step
      for (; d <= until; d += step) push(d)
      continue
    }
    // bulanan: tanggal yang sama tiap bulan (tanggal 31 → hari terakhir bulan)
    const [y0, m0, d0] = it.start_date.split('-').map(Number)
    for (let k = 0; k < 600; k++) {
      const y = y0 + Math.floor((m0 - 1 + k) / 12)
      const m = ((m0 - 1 + k) % 12) + 1
      const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d0, last)).padStart(2, '0')}`
      const d = toDay(ds)
      if (d > until) break
      if (d >= f) push(d)
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.item.start_time ?? '99').localeCompare(b.item.start_time ?? '99'))
}

export const isForPerson = (it: AgendaItem, name: string | null) => !name || !it.assignee || it.assignee.toLowerCase() === name.toLowerCase()
