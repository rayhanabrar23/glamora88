import { useState } from 'react'
import { downloadWorkbook, type SheetSpec } from '../lib/excel'
import { REPORTS, type ReportCtx } from '../lib/reports'
import { useRefs } from '../lib/refs'
import { Button, Card, Field, Input, PageHeader, Select, useToast } from '../components/ui'
import { Icon } from '../components/Icon'

const fileSafe = (s: string) => s.replace(/[\\/:*?"<>|]/g, '-')

export default function Reports() {
  const refs = useRefs()
  const [ctx, setCtx] = useState<ReportCtx>({ from: '', to: '', store: '' })
  const [busy, setBusy] = useState<string | null>(null)
  const toast = useToast()
  const suffix = () => {
    const p = ctx.from || ctx.to ? `${ctx.from || 'awal'} sd ${ctx.to || 'akhir'}` : 'semua periode'
    return `${p}${ctx.store ? ` - ${ctx.store}` : ''}`
  }
  async function run(id: string) {
    setBusy(id)
    try {
      let sheets: SheetSpec[] = []
      let name: string
      if (id === 'all') {
        for (const r of REPORTS) {
          try {
            sheets = sheets.concat(await r.run(ctx))
          } catch {
            // laporan yang datanya belum ada (mis. settlement) dilewati
          }
        }
        name = 'Laporan Lengkap'
      } else {
        const r = REPORTS.find((x) => x.id === id)!
        sheets = await r.run(ctx)
        name = r.title
      }
      await downloadWorkbook(fileSafe(`Glamora88 - ${name} - ${suffix()}.xlsx`), sheets)
      toast('File Excel diunduh')
    } catch (e) {
      toast((e as Error).message, 'bad')
    } finally {
      setBusy(null)
    }
  }
  return (
    <>
      <PageHeader title="Unduh Laporan" />
      <Card title="Filter laporan">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Dari bulan">
            <Input type="month" className="w-[170px]" value={ctx.from} onChange={(e) => setCtx({ ...ctx, from: e.target.value })} />
          </Field>
          <Field label="Sampai bulan">
            <Input type="month" className="w-[170px]" value={ctx.to} onChange={(e) => setCtx({ ...ctx, to: e.target.value })} />
          </Field>
          <Field label="Toko">
            <Select className="w-[190px]" value={ctx.store} onChange={(e) => setCtx({ ...ctx, store: e.target.value })} options={[{ value: '', label: 'Semua toko' }, ...refs.stores]} />
          </Field>
        </div>
      </Card>

      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-gold/40 bg-gold-soft/60 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-navy text-[#d8b878]">
            <Icon name="download" size={20} />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-ink">Laporan Lengkap</div>
          </div>
        </div>
        <Button variant="primary" icon="download" className="h-10 shrink-0" onClick={() => run('all')} disabled={!!busy}>
          {busy === 'all' ? 'Menyiapkan…' : 'Unduh Laporan Lengkap'}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {REPORTS.map((r) => (
          <div key={r.id} className="flex flex-col rounded-2xl border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(27,35,51,0.04)]">
            <div className="text-[15px] font-semibold text-ink">{r.title}</div>
            <div className="mt-3 flex flex-1 flex-wrap content-start gap-1.5">
              {r.sheets.map((s) => (
                <span key={s} className="rounded-md bg-line-soft px-2 py-0.5 text-[11.5px] text-ink-2">
                  {s}
                </span>
              ))}
            </div>
            <Button icon="download" className="mt-4" onClick={() => run(r.id)} disabled={!!busy}>
              {busy === r.id ? 'Menyiapkan…' : 'Unduh Excel'}
            </Button>
          </div>
        ))}
      </div>
    </>
  )
}
