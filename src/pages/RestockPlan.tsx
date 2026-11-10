import { Fragment, useEffect, useState } from 'react'
import { DEFAULT_RESTOCK, Z_OF, type RestockParams, type RestockResult, type RestockRow, type RestockStatus } from '../../shared/restock'
import { api, qs } from '../lib/api'
import { dateLabel, int, rp } from '../lib/format'
import { useData } from '../lib/useData'
import { Icon } from '../components/Icon'
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Select, Stat, Table, td, tdNum, th, useToast } from '../components/ui'

type Res = RestockResult & { params: RestockParams }

const STATUS: Record<RestockStatus, { label: string; tone: 'bad' | 'good' | 'warn' | 'neutral' | 'info' }> = {
  pesan: { label: 'Pesan sekarang', tone: 'bad' },
  aman: { label: 'Aman', tone: 'good' },
  lambat: { label: 'Lambat', tone: 'info' },
  deadstock: { label: 'Deadstock', tone: 'warn' },
  habis: { label: 'Habis, tidak laku', tone: 'neutral' },
}
const ORDER: RestockStatus[] = ['pesan', 'deadstock', 'lambat', 'aman', 'habis']
const dec = (v: number, d = 1) => v.toLocaleString('id-ID', { maximumFractionDigits: d })

export default function RestockPlan() {
  const [p, setP] = useState<RestockParams | null>(null)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [howTo, setHowTo] = useState(true)
  const { data, error, reload } = useData<Res>(`/restock${query}`)
  const toast = useToast()
  useEffect(() => {
    if (data && !p) setP(data.params)
  }, [data, p])
  // hitung ulang setelah pengguna berhenti mengetik
  useEffect(() => {
    if (!p) return
    const t = setTimeout(
      () =>
        setQuery(
          qs({
            leadDays: String(p.leadDays),
            reviewDays: String(p.reviewDays),
            service: String(p.service),
            windowDays: String(p.windowDays),
            deadDays: String(p.deadDays),
            targetMonthly: String(p.targetMonthly ?? 0),
            safetyMode: p.safetyMode,
            safetyDays: String(p.safetyDays),
          }),
        ),
      350,
    )
    return () => clearTimeout(t)
  }, [p])
  if (error) return <ErrorBox message={error} onRetry={reload} />
  if (!data || !p) return <Loading />

  const set = (patch: Partial<RestockParams>) => setP((x) => ({ ...x!, ...patch }))
  async function save() {
    await api.put('/settings', { restock: JSON.stringify(p) })
    toast('Skenario restock disimpan untuk seluruh tim')
  }
  const rows = data.rows
  const sum = (rr: RestockRow[], f: (r: RestockRow) => number) => rr.reduce((a, r) => a + f(r), 0)
  const toOrder = rows.filter((r) => r.orderQty > 0)
  const dead = rows.filter((r) => r.status === 'deadstock')
  const groups = new Map<string, RestockRow[]>()
  for (const r of rows) groups.set(r.product_code, [...(groups.get(r.product_code) ?? []), r])
  const worst = (rr: RestockRow[]) => ORDER.find((s) => rr.some((r) => r.status === s))!
  const sample = [...rows].sort((a, b) => b.daily - a.daily)[0]
  const z = Z_OF[String(p.service)]
  const num = (k: 'leadDays' | 'reviewDays' | 'windowDays' | 'deadDays' | 'safetyDays', min: number) => ({
    type: 'number' as const,
    min,
    value: p[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Math.max(min, Number(e.target.value) || 0) }),
  })

  return (
    <>
      <Card
        title="Skenario restock"
        subtitle={`Laju jual dari penjualan ${dateLabel(data.windowFrom)} – ${dateLabel(data.asOf)} · aktual ±${int(data.actualMonthly)} pcs/bulan`}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setP(DEFAULT_RESTOCK)}>Bawaan</Button>
            <Button variant="primary" icon="check" onClick={save}>
              Simpan skenario
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Field label="Lead time (hari)" hint="Dari bayar sampai barang tiba">
            <Input {...num('leadDays', 0)} />
          </Field>
          <Field label="Jarak antar pesanan (hari)" hint="Seberapa sering restock">
            <Input {...num('reviewDays', 1)} />
          </Field>
          <Field label="Safety stock" hint={p.safetyMode === 'stat' ? 'Dari naik-turunnya penjualan harian' : 'Sekian hari penjualan'}>
            <Select
              value={p.safetyMode}
              onChange={(e) => set({ safetyMode: e.target.value as RestockParams['safetyMode'] })}
              options={[
                { value: 'stat', label: 'Statistik (tingkat layanan)' },
                { value: 'days', label: 'Hari penjualan' },
              ]}
            />
          </Field>
          {p.safetyMode === 'stat' ? (
            <Field label="Tingkat layanan" hint="Peluang tidak kehabisan saat menunggu barang">
              <Select
                value={String(p.service)}
                onChange={(e) => set({ service: Number(e.target.value) as RestockParams['service'] })}
                options={[
                  { value: '0.9', label: '90%' },
                  { value: '0.95', label: '95%' },
                  { value: '0.99', label: '99%' },
                ]}
              />
            </Field>
          ) : (
            <Field label="Safety stock (hari penjualan)">
              <Input {...num('safetyDays', 0)} />
            </Field>
          )}
          <Field label="Jendela data penjualan (hari)" hint="Hari terakhir yang dipakai untuk laju jual">
            <Input {...num('windowDays', 7)} />
          </Field>
          <Field label="Batas deadstock (hari)" hint="Tanpa penjualan selama ini = deadstock">
            <Input {...num('deadDays', 7)} />
          </Field>
          <Field label="Target penjualan (pcs/bulan)" hint={p.targetMonthly ? `${dec(data.factor)}× laju aktual, porsi per SKU mengikuti data` : 'Kosong = pakai laju jual aktual'}>
            <Input type="number" min={0} placeholder={`${int(data.actualMonthly)}`} value={p.targetMonthly ?? ''} onChange={(e) => set({ targetMonthly: Number(e.target.value) > 0 ? Number(e.target.value) : null })} />
          </Field>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon="alert" tone={toOrder.length ? 'bad' : 'good'} label="Perlu dipesan sekarang" value={`${int(sum(toOrder, (r) => r.orderQty))} pcs`} hint={`${toOrder.length} SKU · ${rp(sum(toOrder, (r) => r.orderCost), { compact: true })}`} />
        <Stat icon="product" label="Total safety stock" value={`${int(sum(rows, (r) => r.safety))} pcs`} hint={rp(sum(rows, (r) => r.safety * r.landed), { compact: true })} />
        <Stat icon="stock" label="Deadstock" value={`${int(sum(dead, (r) => r.onHand))} pcs`} hint={dead.length ? `${dead.length} SKU · ${rp(sum(dead, (r) => r.onHand * r.landed), { compact: true })} tertahan` : 'Tidak ada'} />
        <Stat icon="sales" label="Laju jual dipakai" value={`${int(sum(rows, (r) => r.daily) * 30)} pcs/bln`} hint={p.targetMonthly ? 'Target' : 'Aktual di jendela data'} />
      </div>

      <div className="mt-4">
        <Card padded={false}>
          <Table
            head={
              <tr>
                <th className={th}>Produk</th>
                <th className={`${th} text-right`}>Sisa</th>
                <th className={`${th} text-right`}>Dalam perjalanan</th>
                <th className={`${th} text-right`}>Laju jual / bln</th>
                <th className={`${th} text-right`}>Cukup untuk</th>
                <th className={`${th} text-right`}>Safety stock</th>
                <th className={`${th} text-right`}>Reorder point</th>
                <th className={`${th} text-right`}>Saran pesan</th>
                <th className={`${th} text-right`}>Biaya</th>
                <th className={th}>Status</th>
              </tr>
            }
            footer={
              <tr>
                <td className={td}>Total</td>
                <td className={tdNum}>{int(sum(rows, (r) => r.onHand))}</td>
                <td className={tdNum}>{int(sum(rows, (r) => r.inTransit))}</td>
                <td className={tdNum}>{int(sum(rows, (r) => r.daily) * 30)}</td>
                <td className={td} />
                <td className={tdNum}>{int(sum(rows, (r) => r.safety))}</td>
                <td className={tdNum}>{int(sum(rows, (r) => r.rop))}</td>
                <td className={tdNum}>{int(sum(rows, (r) => r.orderQty))}</td>
                <td className={tdNum}>{rp(sum(rows, (r) => r.orderCost), { compact: true })}</td>
                <td className={td} />
              </tr>
            }
          >
            {[...groups.entries()].map(([code, rr]) => {
              const isOpen = open[code]
              const daily = sum(rr, (r) => r.daily)
              const st = worst(rr)
              const cells = (r: { onHand: number; inTransit: number; daily: number; cover: number | null; safety: number; rop: number; orderQty: number; orderCost: number }, bold: boolean) => (
                <>
                  <td className={`${tdNum} ${bold ? 'font-semibold' : ''}`}>{int(r.onHand)}</td>
                  <td className={tdNum}>{r.inTransit ? int(r.inTransit) : '–'}</td>
                  <td className={tdNum}>{r.daily > 0 ? dec(r.daily * 30) : '–'}</td>
                  <td className={tdNum}>{r.cover == null ? '–' : r.cover > 365 ? '> 1 tahun' : `${int(r.cover)} hari`}</td>
                  <td className={tdNum}>{r.safety ? int(r.safety) : '–'}</td>
                  <td className={tdNum}>{r.rop ? int(r.rop) : '–'}</td>
                  <td className={`${tdNum} ${r.orderQty ? 'font-semibold text-bad' : ''}`}>{r.orderQty ? int(r.orderQty) : '–'}</td>
                  <td className={tdNum}>{r.orderQty ? rp(r.orderCost, { compact: true }) : '–'}</td>
                </>
              )
              return (
                <Fragment key={code}>
                  <tr className="cursor-pointer" onClick={() => setOpen((o) => ({ ...o, [code]: !o[code] }))}>
                    <td className={td}>
                      <div className="flex items-center gap-2">
                        <Icon name="chevron" size={16} className={`text-muted transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                        <div>
                          <div className="font-medium text-ink">
                            {code} · {rr[0].product_name}
                          </div>
                          <div className="text-[12px] text-muted">{rr.length} warna</div>
                        </div>
                      </div>
                    </td>
                    {cells(
                      { onHand: sum(rr, (r) => r.onHand), inTransit: sum(rr, (r) => r.inTransit), daily, cover: daily > 0 ? sum(rr, (r) => r.onHand) / daily : null, safety: sum(rr, (r) => r.safety), rop: sum(rr, (r) => r.rop), orderQty: sum(rr, (r) => r.orderQty), orderCost: sum(rr, (r) => r.orderCost) },
                      true,
                    )}
                    <td className={td}>
                      <Badge tone={STATUS[st].tone}>{STATUS[st].label}</Badge>
                    </td>
                  </tr>
                  {isOpen &&
                    rr.map((r) => (
                      <tr key={r.sku} className="bg-canvas/40 text-[13.5px]">
                        <td className={`${td} pl-12`}>
                          <span className="text-ink">{r.color || r.sku}</span>
                          <span className="text-muted">
                            {' '}
                            · {r.sku}
                            {r.status === 'deadstock' ? ` · ${r.daysSinceSale == null ? 'belum pernah laku' : `${int(r.daysSinceSale)} hari tanpa penjualan`}` : ''}
                          </span>
                        </td>
                        {cells({ ...r, cover: r.coverDays }, false)}
                        <td className={td}>
                          <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge>
                        </td>
                      </tr>
                    ))}
                </Fragment>
              )
            })}
          </Table>
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Cara hitung"
          actions={
            <Button variant="ghost" onClick={() => setHowTo((v) => !v)}>
              {howTo ? 'Tutup' : 'Buka'}
            </Button>
          }
        >
          {howTo && (
            <div className="grid gap-3 text-[13.5px] leading-relaxed text-ink-2 md:grid-cols-2">
              <div className="rounded-2xl bg-canvas/70 px-4 py-3">
                <div className="font-semibold text-ink">1 · Lead time</div>
                Jumlah hari dari bayar sampai barang siap dijual. Selama itu penjualan tetap jalan, jadi stok harus cukup untuk menutupnya: laju jual per hari × {int(p.leadDays)} hari.
              </div>
              <div className="rounded-2xl bg-canvas/70 px-4 py-3">
                <div className="font-semibold text-ink">2 · Safety stock</div>
                Stok cadangan untuk penjualan yang lebih ramai dari biasanya.{' '}
                {p.safetyMode === 'stat' ? (
                  <>
                    Rumus: Z × simpangan baku penjualan harian × √lead time, dengan Z = {dec(z, 2)} untuk tingkat layanan {int(p.service * 100)}%.
                  </>
                ) : (
                  <>Rumus: laju jual per hari × {int(p.safetyDays)} hari.</>
                )}
              </div>
              <div className="rounded-2xl bg-canvas/70 px-4 py-3">
                <div className="font-semibold text-ink">3 · Reorder point</div>
                Batas stok untuk mulai memesan: (laju jual per hari × lead time) + safety stock. Bila sisa + barang dalam perjalanan sudah di bawah angka ini, statusnya "Pesan sekarang". Saran pesan mengisi
                stok sampai cukup untuk lead time + {int(p.reviewDays)} hari berikutnya + safety stock.
              </div>
              <div className="rounded-2xl bg-canvas/70 px-4 py-3">
                <div className="font-semibold text-ink">4 · Deadstock</div>
                Stok yang masih ada tetapi tidak terjual lebih dari {int(p.deadDays)} hari, atau belum pernah laku. Modalnya tertahan; jangan direstock, pertimbangkan diskon atau bundling. "Lambat" berarti
                masih laku tetapi stoknya cukup untuk lebih dari 6 bulan.
              </div>
              {sample && sample.daily > 0 && (
                <div className="rounded-2xl bg-gold-soft px-4 py-3 md:col-span-2">
                  <div className="font-semibold text-ink">
                    Contoh: {sample.product_name} · {sample.color}
                  </div>
                  <span className="num">
                    Laju jual {dec(sample.daily, 2)} pcs/hari · kebutuhan selama lead time {dec(sample.daily, 2)} × {int(p.leadDays)} = {int(Math.ceil(sample.daily * p.leadDays))} pcs · safety stock{' '}
                    {p.safetyMode === 'stat' ? `${dec(z, 2)} × ${dec(sample.sigma, 2)} × √${int(p.leadDays)}` : `${dec(sample.daily, 2)} × ${int(p.safetyDays)}`} = {int(sample.safety)} pcs · reorder point = {int(sample.rop)} pcs.
                    Sisa {int(sample.onHand)} pcs{sample.inTransit ? ` + ${int(sample.inTransit)} dalam perjalanan` : ''}, jadi {sample.orderQty ? `pesan ${int(sample.orderQty)} pcs` : 'belum perlu pesan'}.
                  </span>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </>
  )
}
