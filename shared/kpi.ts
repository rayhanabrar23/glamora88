// KPI staf: definisi yang bisa diatur owner, catatan bulanan, dan perhitungan skor & faktor komisi.

export type KpiType = 'auto' | 'checklist' | 'manual'
export type KpiMetric = 'live_sessions' | 'live_pcs' | 'store_pcs' | 'cancel_return' | 'stock_diff' | 'sku_mapped'

export interface KpiDef {
  id: string
  name: string
  type: KpiType
  /** untuk type 'auto' */
  metric?: KpiMetric
  /** bobot (persen); dinormalisasi bila total ≠ 100 */
  weight: number
  /** target bawaan; arti tergantung metrik (lihat METRICS) */
  target: number
  /** batas pencapaian per KPI, mis. 1,5 = 150% */
  maxAchieve: number
  /** butir checklist (type 'checklist') */
  items?: string[]
}

export interface KpiStaff {
  id: string
  name: string
  role: string
  /** nama di Pengaturan › Komisi tim per orang */
  commissionMember: string
  /** nama host di Sesi Live (kosong = sama dengan name) */
  hostName?: string
  kpis: KpiDef[]
}

export interface KpiConfig {
  /** skor maksimal, mis. 1,3 = 130% */
  cap: number
  /** di bawah skor ini komisi 0, mis. 0,75 */
  floor: number
  staff: KpiStaff[]
}

export interface KpiStaffRecord {
  /** target khusus bulan ini per KPI (mengganti target bawaan) */
  targets?: Record<string, number>
  /** centang checklist per KPI, urut sesuai items */
  checks?: Record<string, boolean[]>
  /** realisasi yang diisi manual per KPI */
  manual?: Record<string, number>
  note?: string
}

export interface KpiMonthRecord {
  /** target penjualan toko bulan ini (pcs) */
  storeTarget?: number | null
  staff: Record<string, KpiStaffRecord>
  /** faktor komisi yang sudah dikunci owner, per nama anggota komisi */
  final?: Record<string, number> | null
  finalizedAt?: string | null
}

/** Angka dari data portal untuk satu bulan. */
export interface KpiContext {
  month: string
  storeTarget: number | null
  storePcs: number
  /** (batal + retur) ÷ qty pesanan; null = tidak ada penjualan */
  cancelReturnRate: number | null
  /** selisih stock opname ÷ total stok; null = tidak ada opname bulan ini */
  stockDiffRate: number | null
  /** porsi qty penjualan yang sudah terpetakan ke SKU; null = tidak ada penjualan */
  skuMappedRate: number | null
  /** per nama host (huruf kecil) */
  live: Record<string, { sessions: number; pcs: number; hours: number }>
  /** komisi dasar per nama anggota (sebelum KPI) */
  baseCommission: Record<string, number>
}

export const METRICS: Record<KpiMetric, { label: string; higherBetter: boolean; targetLabel: string; unit: 'count' | 'pcs' | 'pct'; targetIsShare?: boolean }> = {
  live_sessions: { label: 'Sesi live yang dijalankan', higherBetter: true, targetLabel: 'Sesi dijadwalkan', unit: 'count' },
  live_pcs: { label: 'Pcs terjual saat live host', higherBetter: true, targetLabel: '% dari target toko', unit: 'pcs', targetIsShare: true },
  store_pcs: { label: 'Pcs terjual toko', higherBetter: true, targetLabel: '% dari target toko', unit: 'pcs', targetIsShare: true },
  cancel_return: { label: 'Pesanan batal & retur', higherBetter: false, targetLabel: 'Maksimal', unit: 'pct' },
  stock_diff: { label: 'Selisih stock opname', higherBetter: false, targetLabel: 'Maksimal', unit: 'pct' },
  sku_mapped: { label: 'Penjualan terpetakan ke SKU', higherBetter: true, targetLabel: 'Minimal', unit: 'pct' },
}

let seq = 0
const kid = (p: string) => `${p}-${++seq}`

export const DEFAULT_KPI_CONFIG: KpiConfig = (() => {
  const host = (name: string): KpiStaff => ({
    id: name.toLowerCase(),
    name,
    role: 'Host live',
    commissionMember: name,
    kpis: [
      { id: kid('live'), name: 'Live sesuai jadwal (1 bulan full)', type: 'auto', metric: 'live_sessions', weight: 30, target: 26, maxAchieve: 1 },
      { id: kid('pcs'), name: 'Pcs terjual saat live', type: 'auto', metric: 'live_pcs', weight: 50, target: 0.5, maxAchieve: 1.5 },
      { id: kid('tepat'), name: 'Ketepatan waktu live', type: 'manual', weight: 20, target: 100, maxAchieve: 1 },
    ],
  })
  return {
    cap: 1.3,
    floor: 0.75,
    staff: [
      host('Tiara'),
      host('Agus'),
      {
        id: 'icha',
        name: 'Icha',
        role: 'Admin',
        commissionMember: 'Icha',
        kpis: [
          {
            id: kid('data'),
            name: 'Data portal tepat waktu',
            type: 'checklist',
            weight: 20,
            target: 1,
            maxAchieve: 1,
            items: ['Export penjualan diunggah tiap minggu', 'Settlement diunggah tiap dana cair', 'Biaya operasional dicatat akhir bulan', 'Boost tercatat'],
          },
          { id: kid('retur'), name: 'Pesanan batal & retur', type: 'auto', metric: 'cancel_return', weight: 15, target: 0.03, maxAchieve: 1 },
          { id: kid('stok'), name: 'Akurasi stok (stock opname)', type: 'auto', metric: 'stock_diff', weight: 20, target: 0.02, maxAchieve: 1 },
          { id: kid('sku'), name: 'SKU terpetakan', type: 'auto', metric: 'sku_mapped', weight: 10, target: 1, maxAchieve: 1 },
          {
            id: kid('ops'),
            name: 'Operasional harian',
            type: 'checklist',
            weight: 20,
            target: 1,
            maxAchieve: 1,
            items: ['Pesanan dikirim ≤ 1×24 jam', 'Chat dibalas ≤ 1 jam', 'Packing rapi', 'Restock diajukan tepat waktu', 'Laporan rutin ke owner'],
          },
          { id: kid('toko'), name: 'Target penjualan toko', type: 'auto', metric: 'store_pcs', weight: 15, target: 1, maxAchieve: 1.5 },
        ],
      },
    ],
  }
})()

export function parseKpiConfig(raw: string | undefined | null): KpiConfig {
  if (!raw) return DEFAULT_KPI_CONFIG
  try {
    const v = JSON.parse(raw) as KpiConfig
    if (!Array.isArray(v.staff)) return DEFAULT_KPI_CONFIG
    return { cap: Number(v.cap) || 1.3, floor: Number.isFinite(Number(v.floor)) ? Number(v.floor) : 0.75, staff: v.staff }
  } catch {
    return DEFAULT_KPI_CONFIG
  }
}

export function parseKpiMonth(raw: string | undefined | null): KpiMonthRecord {
  if (!raw) return { staff: {} }
  try {
    const v = JSON.parse(raw) as KpiMonthRecord
    return { ...v, staff: v.staff ?? {} }
  } catch {
    return { staff: {} }
  }
}

export const kpiMonthKey = (month: string) => `kpi_month_${month}`

export interface KpiLine {
  def: KpiDef
  /** target yang dipakai (sudah dengan target khusus bulan ini) */
  target: number
  /** target dalam satuan realisasi (mis. pcs untuk target berupa porsi) */
  targetValue: number | null
  actual: number | null
  /** pencapaian 0..maxAchieve; null = belum ada data (tidak ikut dihitung) */
  achievement: number | null
  /** bobot ternormalisasi (0..1) di antara KPI yang punya data */
  weightShare: number
  contribution: number
  reason?: string
}

export interface KpiStaffResult {
  staff: KpiStaff
  lines: KpiLine[]
  /** skor sebelum dibatasi */
  rawScore: number | null
  score: number | null
  factor: number
  status: 'sangat-baik' | 'baik' | 'perbaikan' | 'tanpa-komisi' | 'belum-ada-data'
  baseCommission: number
  finalCommission: number
  weightTotal: number
}

export function computeKpi(cfg: KpiConfig, rec: KpiMonthRecord, ctx: KpiContext): KpiStaffResult[] {
  return cfg.staff.map((st) => {
    const r = rec.staff[st.id] ?? {}
    const host = (st.hostName || st.name).trim().toLowerCase()
    const live = ctx.live[host] ?? { sessions: 0, pcs: 0, hours: 0 }
    const lines: KpiLine[] = st.kpis.map((d) => {
      const target = r.targets?.[d.id] ?? d.target
      let actual: number | null = null
      let targetValue: number | null = target
      let higher = true
      let reason: string | undefined
      if (d.type === 'checklist') {
        const items = d.items ?? []
        const checks = r.checks?.[d.id] ?? []
        actual = items.length ? items.filter((_, i) => checks[i]).length / items.length : null
        targetValue = 1
        if (!items.length) reason = 'Belum ada butir checklist'
      } else if (d.type === 'manual') {
        const v = r.manual?.[d.id]
        actual = v == null || !Number.isFinite(v) ? null : v
        if (actual == null) reason = 'Belum diisi'
      } else {
        const m = d.metric ? METRICS[d.metric] : null
        higher = m?.higherBetter ?? true
        if (m?.targetIsShare) {
          targetValue = ctx.storeTarget ? target * ctx.storeTarget : null
          if (!ctx.storeTarget) reason = 'Target toko bulan ini belum diisi'
        }
        switch (d.metric) {
          case 'live_sessions':
            actual = live.sessions
            break
          case 'live_pcs':
            actual = live.pcs
            break
          case 'store_pcs':
            actual = ctx.storePcs
            break
          case 'cancel_return':
            actual = ctx.cancelReturnRate
            if (actual == null) reason = 'Belum ada penjualan'
            break
          case 'stock_diff':
            actual = ctx.stockDiffRate
            if (actual == null) reason = 'Belum ada stock opname bulan ini'
            break
          case 'sku_mapped':
            actual = ctx.skuMappedRate
            if (actual == null) reason = 'Belum ada penjualan'
            break
        }
      }
      let achievement: number | null = null
      if (actual != null && targetValue != null) {
        if (higher) achievement = targetValue > 0 ? actual / targetValue : actual > 0 ? d.maxAchieve : 1
        else achievement = actual <= targetValue ? 1 : actual > 0 ? targetValue / actual : 1
        achievement = Math.max(0, Math.min(d.maxAchieve || 1, achievement))
      }
      return { def: d, target, targetValue, actual, achievement, weightShare: 0, contribution: 0, reason }
    })
    const counted = lines.filter((l) => l.achievement != null)
    const wSum = counted.reduce((a, l) => a + Math.max(0, l.def.weight), 0)
    for (const l of counted) {
      l.weightShare = wSum ? Math.max(0, l.def.weight) / wSum : 0
      l.contribution = l.weightShare * (l.achievement ?? 0)
    }
    const rawScore = counted.length && wSum ? counted.reduce((a, l) => a + l.contribution, 0) : null
    const score = rawScore == null ? null : Math.min(cfg.cap, rawScore)
    const factor = score == null ? 0 : score >= cfg.floor ? score : 0
    const status: KpiStaffResult['status'] =
      score == null ? 'belum-ada-data' : score < cfg.floor ? 'tanpa-komisi' : score >= 0.9 ? 'sangat-baik' : score >= 0.75 ? 'baik' : 'perbaikan'
    const base = ctx.baseCommission[st.commissionMember] ?? 0
    return {
      staff: st,
      lines,
      rawScore,
      score,
      factor,
      status,
      baseCommission: base,
      finalCommission: Math.round(base * factor),
      weightTotal: st.kpis.reduce((a, k) => a + Math.max(0, k.weight), 0),
    }
  })
}
