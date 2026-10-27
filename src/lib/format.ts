export const rp = (v: number | null | undefined, opts: { compact?: boolean } = {}) => {
  if (v == null || !Number.isFinite(v)) return '–'
  const sign = v < 0 ? '−' : ''
  const a = Math.abs(v)
  if (opts.compact) {
    if (a >= 1e9) return `${sign}Rp${(a / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`
    if (a >= 1e6) return `${sign}Rp${(a / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`
    if (a >= 1e3) return `${sign}Rp${(a / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`
  }
  return `${sign}Rp${Math.round(a).toLocaleString('id-ID')}`
}
export const int = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '–' : Math.round(v).toLocaleString('id-ID'))
export const pct = (v: number | null | undefined, d = 1) =>
  v == null || !Number.isFinite(v) ? '–' : `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: 0 })}%`

const BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
const BULAN_PANJANG = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
export const monthLabel = (ym: string, long = false) => {
  const [y, m] = ym.split('-').map(Number)
  return `${(long ? BULAN_PANJANG : BULAN)[m - 1]} ${long ? y : String(y).slice(2)}`
}
export const dateLabel = (s: string | null | undefined) => {
  if (!s) return '–'
  const [d, t] = s.split(' ')
  const [y, m, dd] = d.split('-').map(Number)
  return `${dd} ${BULAN[m - 1]} ${y}${t && t !== '00:00:00' ? ' · ' + t.slice(0, 5) : ''}`
}
export const today = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
export const thisMonth = () => today().slice(0, 7)
