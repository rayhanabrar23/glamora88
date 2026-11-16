// Komisi tim per orang: persen dari pendapatan bersih bulanan (omzet − potongan TikTok).
export interface TeamMember {
  name: string
  pct: number
}
export interface TeamCommission {
  /** Bulan mulai dihitung otomatis (YYYY-MM). Sebelum bulan ini komisi dicatat manual di Biaya Operasional. */
  start: string
  members: TeamMember[]
}

export const DEFAULT_TEAM_COMMISSION: TeamCommission = {
  start: '2026-12',
  members: [
    { name: 'Agus', pct: 0.02 },
    { name: 'Icha', pct: 0.03 },
    { name: 'Tiara', pct: 0.04 },
  ],
}

export function parseTeamCommission(raw: string | undefined | null): TeamCommission {
  if (!raw) return { start: DEFAULT_TEAM_COMMISSION.start, members: [] }
  try {
    const v = JSON.parse(raw) as Partial<TeamCommission>
    const members = (Array.isArray(v.members) ? v.members : [])
      .map((m) => ({ name: String(m?.name ?? '').trim(), pct: Number(m?.pct) }))
      .filter((m) => m.name && Number.isFinite(m.pct) && m.pct > 0)
    const start = typeof v.start === 'string' && /^\d{4}-\d{2}$/.test(v.start) ? v.start : DEFAULT_TEAM_COMMISSION.start
    return { start, members }
  } catch {
    return { start: DEFAULT_TEAM_COMMISSION.start, members: [] }
  }
}

export const teamPct = (t: TeamCommission) => t.members.reduce((a, m) => a + m.pct, 0)

/** Komisi per orang untuk satu bulan. Pendapatan bersih negatif tidak menghasilkan komisi. */
export function commissionFor(t: TeamCommission, month: string, netRevenue: number) {
  const by: Record<string, number> = {}
  if (month < t.start) return { total: 0, by }
  const base = Math.max(0, netRevenue)
  let total = 0
  for (const m of t.members) {
    const v = Math.round(base * m.pct)
    by[m.name] = (by[m.name] ?? 0) + v
    total += v
  }
  return { total, by }
}
