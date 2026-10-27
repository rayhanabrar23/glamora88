// Pembuat file Excel yang rapi (judul, header berwarna, format Rupiah, total).
import writeXlsxFile from 'write-excel-file/browser'
import type { Cell, Row, Sheet } from 'write-excel-file/browser'

type Kind = 'text' | 'rp' | 'int' | 'pct' | 'dec' | 'date' | 'datetime' | 'month'
export interface Col<T> {
  header: string
  value: (r: T) => string | number | null | undefined
  kind?: Kind
  width?: number
  total?: 'sum' | ((rows: T[]) => string | number | null)
}
export interface Block<T> {
  heading?: string
  columns: Col<T>[]
  rows: T[]
  note?: string
  /** satu sel selebar tabel per baris (untuk teks panjang), memakai kolom pertama */
  fullWidth?: boolean
}

const NAVY = '#1F2A44'
const GOLD = '#A8843F'
const LINE = '#E8E3DA'
const SOFT = '#F5F2EC'
const MUTED = '#7B8291'
const FMT: Record<Kind, string | undefined> = {
  text: undefined,
  rp: '"Rp"#,##0;-"Rp"#,##0;"-"',
  int: '#,##0;-#,##0;"-"',
  pct: '0.0%',
  dec: '#,##0.0',
  date: 'dd/mm/yyyy',
  datetime: 'dd/mm/yyyy hh:mm',
  month: 'mmm yyyy',
}

/** 'YYYY-MM-DD[ HH:MM:SS]' atau 'YYYY-MM' → Date (UTC, agar jam tidak bergeser di Excel). */
export function toDate(s: string | null | undefined): Date | null {
  if (!s) return null
  const [d, t = '00:00:00'] = s.split(' ')
  const [y, m, dd = 1] = d.split('-').map(Number)
  const [hh, mi, ss] = t.split(':').map(Number)
  if (!y || !m) return null
  return new Date(Date.UTC(y, m - 1, dd, hh || 0, mi || 0, ss || 0))
}

function cell(v: unknown, kind: Kind = 'text', extra: Partial<Record<string, unknown>> = {}): Cell {
  if (v == null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) return { value: '', ...extra } as Cell
  if (kind === 'date' || kind === 'datetime' || kind === 'month') {
    const d = v instanceof Date ? v : toDate(String(v))
    return d ? ({ value: d, type: Date, format: FMT[kind], ...extra } as Cell) : ({ value: String(v), ...extra } as Cell)
  }
  if (kind !== 'text' && typeof v === 'number') return { value: v, type: Number, format: FMT[kind], align: 'right', ...extra } as Cell
  return { value: String(v), type: String, ...extra } as Cell
}

export interface SheetSpec {
  name: string
  title: string
  meta: string
  blocks: Block<any>[] // eslint-disable-line @typescript-eslint/no-explicit-any
}

export function buildSheet(spec: SheetSpec): Sheet<Blob> {
  const width = Math.max(...spec.blocks.map((b) => b.columns.length), 2)
  const data: Row[] = []
  data.push([{ value: `GLAMORA88 · ${spec.title}`, fontWeight: 'bold', fontSize: 14, textColor: NAVY, columnSpan: width } as Cell, ...Array(width - 1).fill(null)])
  data.push([{ value: spec.meta, textColor: MUTED, fontSize: 10, columnSpan: width } as Cell, ...Array(width - 1).fill(null)])
  let sticky = 0
  const colWidths = Array.from({ length: width }, () => 10)
  spec.blocks.forEach((b, bi) => {
    data.push([])
    if (b.heading) data.push([{ value: b.heading, fontWeight: 'bold', textColor: GOLD, fontSize: 12, columnSpan: width } as Cell, ...Array(width - 1).fill(null)])
    if (b.fullWidth) {
      data.push([cell(b.columns[0].header, 'text', { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: NAVY, columnSpan: width }), ...Array(width - 1).fill(null)])
      b.rows.forEach((r) =>
        data.push([cell(b.columns[0].value(r), 'text', { wrap: true, columnSpan: width, alignVertical: 'top', bottomBorderColor: LINE, bottomBorderStyle: 'thin' }), ...Array(width - 1).fill(null)]),
      )
      return
    }
    const header: Row = b.columns.map((c) =>
      cell(c.header, 'text', { fontWeight: 'bold', textColor: '#FFFFFF', backgroundColor: NAVY, align: c.kind && c.kind !== 'text' ? 'right' : 'left', wrap: true, alignVertical: 'center', height: 30 }),
    )
    data.push(header)
    if (bi === 0 && spec.blocks.length === 1) sticky = data.length
    b.rows.forEach((r, i) => {
      data.push(
        b.columns.map((c) =>
          cell(c.value(r), c.kind, { bottomBorderColor: LINE, bottomBorderStyle: 'thin', ...(i % 2 ? { backgroundColor: '#FCFBF9' } : {}) }),
        ),
      )
    })
    if (b.columns.some((c) => c.total)) {
      data.push(
        b.columns.map((c, i) => {
          const v = typeof c.total === 'function' ? c.total(b.rows) : c.total === 'sum' ? b.rows.reduce((a, r) => a + (Number(c.value(r)) || 0), 0) : i === 0 ? 'TOTAL' : ''
          return cell(v, c.total ? c.kind : 'text', { fontWeight: 'bold', backgroundColor: SOFT, topBorderColor: NAVY, topBorderStyle: 'thin' })
        }),
      )
    }
    if (b.note) data.push([{ value: b.note, textColor: MUTED, fontSize: 9, fontStyle: 'italic', columnSpan: width, wrap: true } as Cell, ...Array(width - 1).fill(null)])
    b.columns.forEach((c, i) => {
      const len = Math.max(c.header.length * 0.9, ...b.rows.slice(0, 300).map((r) => fmtLen(c.value(r), c.kind)))
      colWidths[i] = Math.max(colWidths[i], Math.min(c.width ?? Math.ceil(len) + 3, 60))
    })
  })
  return {
    data,
    sheet: spec.name.slice(0, 31),
    columns: colWidths.map((w) => ({ width: w })),
    stickyRowsCount: sticky || undefined,
    showGridLines: false,
    ...(width > 7 ? { orientation: 'landscape' as const } : {}),
  }
}

function fmtLen(v: unknown, kind?: Kind) {
  if (v == null) return 0
  if (kind === 'rp') return String(Math.round(Number(v))).length * 1.35 + 3
  if (kind === 'date') return 11
  if (kind === 'datetime') return 16
  if (kind === 'month') return 9
  return String(v).length
}

export async function downloadWorkbook(fileName: string, sheets: SheetSpec[]) {
  await writeXlsxFile(sheets.map(buildSheet), { fontFamily: 'Calibri', fontSize: 11 }).toFile(fileName)
}
