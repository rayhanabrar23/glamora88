import { useState } from 'react'
import readXlsxFile, { readSheetNames } from 'read-excel-file'
import { parseSettlementRows, type SettlementParse } from '../../shared/settlement'
import { parseCsv } from '../../shared/tiktok'
import { api } from '../lib/api'
import { dateLabel, int, monthLabel, pct, rp } from '../lib/format'
import { useRefs } from '../lib/refs'
import { useData } from '../lib/useData'
import { ModelBars } from '../components/charts'
import { Badge, Button, Callout, Card, Empty, ErrorBox, Field, Loading, PageHeader, Select, Stat, Table, td, tdNum, th, useToast } from '../components/ui'

interface Report {
  totals: { lines: number; orders: number; revenue: number; fees: number; amount: number; adjustments: number; stores: string[]; from: string | null; to: string | null }
  byMonth: { month: string; count: number; revenue: number; fees: number; amount: number }[]
  components: { name: string; total: number }[]
  comparison: { matched: number; matchedOmzet: number; estFees: number; actFees: number }
  unsettled: { count: number; omzet: number; items: { store: string; order_id: string; date: string; omzet: number }[] }
}

export default function Settlement() {
  const { data, error, reload } = useData<Report>('/settlements/report')
  const refs = useRefs()
  const toast = useToast()
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data) return <Loading />
  const t = data.totals
  const cmp = data.comparison
  async function clear(store: string) {
    if (!window.confirm(`Hapus semua data settlement ${store}? Data penjualan tidak terpengaruh.`)) return
    await api.del(`/settlements?store=${encodeURIComponent(store)}`)
    toast('Data settlement dihapus')
    reload()
  }
  return (
    <>
      <PageHeader
        title="Pencairan TikTok"
      />
      <Upload stores={refs.stores} onSaved={reload} />

      {!t.lines ? (
        <div className="mt-4">
          <Empty title="Belum ada laporan settlement" />
        </div>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label="Dana cair" value={rp(t.amount, { compact: true })} hint={`${int(t.orders)} pesanan · ${dateLabel(t.from?.slice(0, 10))} – ${dateLabel(t.to?.slice(0, 10))}`} />
            <Stat label="Total potongan TikTok" value={rp(t.fees, { compact: true })} hint={t.revenue ? `${pct(t.fees / t.revenue)} dari pendapatan ${rp(t.revenue, { compact: true })}` : undefined} />
            <Stat
              label="Perkiraan vs aktual"
              value={cmp.matched ? `${cmp.actFees >= cmp.estFees ? '+' : '−'}${rp(Math.abs(cmp.actFees - cmp.estFees), { compact: true }).replace('−', '')}` : '–'}
              tone={cmp.matched ? (cmp.actFees > cmp.estFees * 1.05 ? 'bad' : 'good') : 'neutral'}
              hint={
                cmp.matched
                  ? `${int(cmp.matched)} pesanan cocok: aktual ${pct(cmp.matchedOmzet ? cmp.actFees / cmp.matchedOmzet : 0)} vs perkiraan ${pct(cmp.matchedOmzet ? cmp.estFees / cmp.matchedOmzet : 0)} dari omzet`
                  : 'Belum ada pesanan yang cocok dengan data penjualan'
              }
            />
            <Stat
              label="Terjual tapi belum cair"
              value={`${int(data.unsettled.count)} pesanan`}
              tone={data.unsettled.count ? 'bad' : 'good'}
              hint={data.unsettled.count ? `${rp(data.unsettled.omzet, { compact: true })} omzet dalam periode laporan` : 'Semua pesanan dalam periode laporan sudah cair'}
            />
          </div>


          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Komponen potongan & pendapatan">
              {data.components.length ? (
                <ModelBars
                  data={data.components.slice(0, 10).map((c) => ({
                    label: c.name,
                    value: Math.abs(c.total),
                    sub: rp(c.total, { compact: true }),
                  }))}
                />
              ) : (
                <p className="text-[14px] text-muted">Laporan tidak memuat rincian potongan.</p>
              )}
            </Card>
            <Card title="Per bulan pencairan" padded={false}>
              <Table
                head={
                  <tr>
                    <th className={th}>Bulan</th>
                    <th className={`${th} text-right`}>Baris</th>
                    <th className={`${th} text-right`}>Pendapatan</th>
                    <th className={`${th} text-right`}>Potongan</th>
                    <th className={`${th} text-right`}>%</th>
                    <th className={`${th} text-right`}>Dana cair</th>
                  </tr>
                }
              >
                {data.byMonth.map((m) => (
                  <tr key={m.month}>
                    <td className={td}>{/^\d{4}-\d{2}$/.test(m.month) ? monthLabel(m.month, true) : m.month}</td>
                    <td className={tdNum}>{int(m.count)}</td>
                    <td className={tdNum}>{rp(m.revenue, { compact: true })}</td>
                    <td className={tdNum}>{rp(m.fees, { compact: true })}</td>
                    <td className={tdNum}>{m.revenue ? pct(m.fees / m.revenue) : '–'}</td>
                    <td className={`${tdNum} font-medium`}>{rp(m.amount, { compact: true })}</td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>

          {data.unsettled.count > 0 && (
            <div className="mt-4">
              <Card title="Pesanan belum cair" padded={false}>
                <Table
                  head={
                    <tr>
                      <th className={th}>Tanggal pesanan</th>
                      <th className={th}>Toko</th>
                      <th className={th}>No. pesanan</th>
                      <th className={`${th} text-right`}>Omzet</th>
                    </tr>
                  }
                >
                  {data.unsettled.items.map((o) => (
                    <tr key={o.store + o.order_id}>
                      <td className={td}>{dateLabel(o.date)}</td>
                      <td className={td}>{o.store}</td>
                      <td className={`${td} num`}>{o.order_id}</td>
                      <td className={tdNum}>{rp(o.omzet)}</td>
                    </tr>
                  ))}
                </Table>
                {data.unsettled.count > data.unsettled.items.length && (
                  <p className="border-t border-line-soft px-5 py-3 text-[13px] text-muted">Menampilkan 50 dari {int(data.unsettled.count)} pesanan.</p>
                )}
              </Card>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            Data tersimpan untuk:
            {t.stores.map((s) => (
              <span key={s} className="inline-flex items-center gap-1">
                <Badge>{s}</Badge>
                <button className="text-bad underline" onClick={() => clear(s)}>
                  hapus
                </button>
              </span>
            ))}
          </div>
        </>
      )}
    </>
  )
}

function Upload({ stores, onSaved }: { stores: string[]; onSaved: () => void }) {
  const [store, setStore] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [parsed, setParsed] = useState<SettlementParse | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  async function read(f: File) {
    setFile(f)
    setParsed(null)
    setErr(null)
    try {
      let result: SettlementParse | null = null
      if (/\.csv$/i.test(f.name)) result = parseSettlementRows(parseCsv(await f.text()))
      else {
        let lastErr: Error | null = null
        for (const sheet of await readSheetNames(f)) {
          try {
            result = parseSettlementRows((await readXlsxFile(f, { sheet })) as never)
          } catch (e) {
            lastErr = e as Error
            result = null
          }
          if (result && result.lines.length) break
        }
        if ((!result || !result.lines.length) && lastErr)
          throw new Error(`File Excel tidak bisa dibaca (${lastErr.message}). Coba ekspor ulang sebagai .csv, lalu unggah file .csv-nya.`)
      }
      if (!result || !result.lines.length)
        throw new Error('Kolom ID pesanan dan jumlah penyelesaian (settlement amount) tidak ditemukan. Pastikan ini laporan Income/Settlement TikTok.')
      setParsed(result)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function save() {
    if (!parsed || !store) return
    setBusy(true)
    try {
      await api.post('/settlements/import', { store, lines: parsed.lines })
      toast(`${int(parsed.lines.length)} baris settlement disimpan`)
      setParsed(null)
      setFile(null)
      onSaved()
      window.dispatchEvent(new Event('g88:refresh'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const sum = (k: 'revenue' | 'fees' | 'amount') => parsed?.lines.reduce((a, l) => a + l[k], 0) ?? 0
  return (
    <Card title="Unggah laporan settlement">
      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <div className="flex flex-col gap-3">
          <Field label="Toko">
            <Select value={store} onChange={(e) => setStore(e.target.value)} options={[{ value: '', label: 'Pilih toko…' }, ...stores]} />
          </Field>
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line bg-canvas/50 px-4 py-6 text-center transition-colors hover:border-gold">
            <input type="file" accept=".xlsx,.csv" className="hidden" onChange={(e) => e.target.files?.[0] && read(e.target.files[0])} />
            <span className="text-[14px] font-medium text-navy">{file ? file.name : 'Pilih file .xlsx / .csv'}</span>
          </label>
        </div>
        <div>
          {err && <Callout tone="critical" title="File tidak bisa dibaca">{err}</Callout>}
          {!parsed && !err && <Empty title="Belum ada file" />}
          {parsed && (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Baris" value={int(parsed.lines.length)} hint={parsed.dateRange ? `${dateLabel(parsed.dateRange[0].slice(0, 10))} – ${dateLabel(parsed.dateRange[1].slice(0, 10))}` : undefined} />
                <Stat label="Potongan" value={rp(sum('fees'), { compact: true })} hint={sum('revenue') ? `${pct(sum('fees') / sum('revenue'))} dari pendapatan` : undefined} />
                <Stat label="Dana cair" value={rp(sum('amount'), { compact: true })} />
              </div>
              <div className="rounded-xl bg-canvas px-4 py-3 text-[13px] text-ink-2">
                <div>
                  Kolom dikenali: ID <b>{parsed.columns.id}</b> · dana cair <b>{parsed.columns.amount}</b>
                  {parsed.columns.revenue && (
                    <>
                      {' '}
                      · pendapatan <b>{parsed.columns.revenue}</b>
                    </>
                  )}
                  {parsed.columns.fees && (
                    <>
                      {' '}
                      · potongan <b>{parsed.columns.fees}</b>
                    </>
                  )}
                </div>
                {parsed.columns.details.length > 0 && <div className="mt-1 text-muted">Rincian: {parsed.columns.details.join(', ')}</div>}
              </div>
              <Button variant="primary" icon="upload" onClick={save} disabled={busy || !store} className="self-start">
                {busy ? 'Menyimpan…' : store ? `Simpan untuk ${store}` : 'Pilih toko dulu'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}
