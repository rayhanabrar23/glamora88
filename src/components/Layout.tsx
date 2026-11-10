import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { DashboardData, Insight } from '../../shared/dashboard'
import { useData } from '../lib/useData'
import { Icon } from './Icon'
import { cx } from './ui'

const NAV = [
  { to: '/', label: 'Ringkasan', icon: 'dashboard', end: true },
  { to: '/penjualan', label: 'Penjualan', icon: 'sales' },
  { to: '/pencairan', label: 'Pencairan TikTok', icon: 'wallet' },
  { to: '/pembelian', label: 'Pembelian & Impor', icon: 'purchase' },
  { to: '/produk', label: 'Produk & Stok', icon: 'product' },
  { to: '/live', label: 'Sesi Live', icon: 'live' },
  { to: '/boost', label: 'Boost & Promosi', icon: 'boost' },
  { to: '/biaya', label: 'Biaya Operasional', icon: 'expense' },
  { to: '/proyeksi', label: 'Proyeksi Kas', icon: 'up' },
  { to: '/laporan', label: 'Unduh Laporan', icon: 'download' },
  { to: '/pengaturan', label: 'Pengaturan', icon: 'settings' },
]

function useClickOutside(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('mousedown', h)
    document.addEventListener('keydown', k)
    return () => {
      document.removeEventListener('mousedown', h)
      document.removeEventListener('keydown', k)
    }
  }, [onClose])
  return ref
}

function Brand() {
  return (
    <Link to="/" className="flex shrink-0 items-center gap-2.5">
      <img src="/logo-mark.png" alt="Glamora88" className="h-10 w-10 object-contain" />
      <div>
        <div className="text-[15px] leading-none font-semibold tracking-[0.12em] text-[#a8843f] uppercase">Glamora.id</div>
        <div className="mt-1 text-[10.5px] tracking-[0.14em] text-muted uppercase">Portal Bisnis</div>
      </div>
    </Link>
  )
}

function Rail({ onLogout }: { onLogout: () => void }) {
  const tip =
    'pointer-events-none absolute left-full z-50 ml-3 translate-x-[-4px] rounded-lg bg-ink px-2.5 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-white opacity-0 shadow-lg transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100 group-focus-visible:opacity-100'
  return (
    <aside className="rail fixed top-1/2 left-5 z-40 hidden -translate-y-1/2 flex-col items-center gap-1 rounded-[26px] p-2.5 lg:flex">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          aria-label={n.label}
          className={({ isActive }) =>
            cx(
              'rail-item group relative flex items-center justify-center rounded-[14px] transition-all duration-200',
              isActive ? 'bg-white text-navy shadow-[0_6px_16px_rgba(0,0,0,0.25)]' : 'text-white/60 hover:bg-white/10 hover:text-white',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon name={n.icon} size={18} />
              {isActive && <span className="absolute -right-[3px] h-1.5 w-1.5 rounded-full bg-gold ring-2 ring-white" />}
              <span className={tip}>{n.label}</span>
            </>
          )}
        </NavLink>
      ))}
      <span className="my-1 h-px w-6 bg-white/15" />
      <button onClick={onLogout} aria-label="Keluar" className="rail-item group relative flex items-center justify-center rounded-[14px] text-white/60 transition-colors hover:bg-white/10 hover:text-white">
        <Icon name="logout" size={18} />
        <span className={tip}>Keluar</span>
      </button>
    </aside>
  )
}

function QuickSearch() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const ref = useClickOutside(() => setOpen(false))
  const hits = useMemo(() => NAV.filter((n) => n.label.toLowerCase().includes(q.trim().toLowerCase())), [q])
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])
  const go = (to: string) => {
    navigate(to)
    setQ('')
    setOpen(false)
    input.current?.blur()
  }
  return (
    <div ref={ref} className="relative hidden w-full max-w-[340px] md:block">
      <Icon name="search" size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && hits[0] && go(hits[0].to)}
        placeholder="Cari menu…"
        aria-label="Cari menu"
        className="h-10 w-full rounded-full border border-white/80 bg-white/60 pr-14 pl-10 text-[14px] text-ink outline-none transition-all placeholder:text-muted/80 focus:border-gold focus:bg-white focus:ring-2 focus:ring-gold-soft"
      />
      <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded-md border border-line bg-white/80 px-1.5 py-0.5 text-[10.5px] font-medium text-muted">Ctrl K</kbd>
      {open && (
        <div className="glass-strong pop-in absolute top-12 right-0 left-0 z-50 rounded-2xl p-1.5">
          {hits.length ? (
            hits.map((n) => (
              <button key={n.to} onMouseDown={() => go(n.to)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-[14px] font-medium text-ink-2 hover:bg-gold-soft/70 hover:text-navy">
                <Icon name={n.icon} size={16} className="text-muted" />
                {n.label}
              </button>
            ))
          ) : (
            <div className="px-3 py-3 text-[13.5px] text-muted">Menu tidak ditemukan</div>
          )}
        </div>
      )}
    </div>
  )
}

const TONE: Record<Insight['tone'], [string, string, string]> = {
  good: ['bg-good-soft', 'text-good', 'check'],
  warning: ['bg-warn-soft', 'text-warn', 'alert'],
  critical: ['bg-bad-soft', 'text-bad', 'alert'],
  info: ['bg-info-soft', 'text-info', 'info'],
}

function Notifications() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<'all' | 'need'>('all')
  const { data } = useData<DashboardData>('/dashboard')
  const ref = useClickOutside(() => setOpen(false))
  const all = data?.insights ?? []
  const need = all.filter((i) => i.tone === 'warning' || i.tone === 'critical')
  const items = tab === 'all' ? all : need
  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={`Catatan (${need.length} perlu perhatian)`}
        aria-expanded={open}
        className={cx('relative flex h-10 w-10 items-center justify-center rounded-full border border-white/80 text-ink-2 transition-colors hover:bg-white hover:text-navy', open ? 'bg-white text-navy' : 'bg-white/60')}
      >
        <Icon name="bell" size={18} />
        {need.length > 0 && (
          <span className="num absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-bad px-1 text-[10.5px] font-semibold text-white ring-2 ring-white">{need.length}</span>
        )}
      </button>
      {open && (
        <div className="glass-strong pop-in absolute top-12 right-0 z-50 w-[min(380px,calc(100vw-2rem))] rounded-3xl">
          <div className="flex items-center justify-between px-5 pt-4">
            <div className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              Catatan <span className="num rounded-full bg-navy px-2 py-0.5 text-[11px] text-white">{all.length}</span>
            </div>
            <div className="inline-flex rounded-full bg-line-soft p-0.5 text-[12.5px] font-medium">
              {(
                [
                  ['all', 'Semua'],
                  ['need', 'Perlu perhatian'],
                ] as const
              ).map(([v, l]) => (
                <button key={v} onClick={() => setTab(v)} className={cx('rounded-full px-3 py-1 transition-colors', tab === v ? 'bg-white text-navy shadow-sm' : 'text-muted hover:text-navy')}>
                  {l}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-3 max-h-[52vh] overflow-y-auto px-2 pb-2">
            {items.length ? (
              items.map((i) => (
                <div key={i.title} className="flex gap-3 rounded-2xl px-3 py-3 transition-colors hover:bg-canvas/70">
                  <span className={cx('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl', TONE[i.tone][0], TONE[i.tone][1])}>
                    <Icon name={TONE[i.tone][2]} size={15} />
                  </span>
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-ink">{i.title}</div>
                    <div className="mt-0.5 text-[12.5px] leading-relaxed text-ink-2">{i.detail}</div>
                  </div>
                </div>
              ))
            ) : (
              <div className="px-3 py-8 text-center text-[13.5px] text-muted">Tidak ada catatan</div>
            )}
          </div>
          <Link to="/" onClick={() => setOpen(false)} className="flex items-center justify-center gap-2 rounded-b-3xl border-t border-line-soft px-5 py-3 text-[13px] font-semibold text-navy hover:bg-gold-soft/50">
            Lihat ringkasan <Icon name="arrow" size={14} />
          </Link>
        </div>
      )}
    </div>
  )
}

export function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const today = new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="min-h-full lg:pl-[92px]">
      <Rail onLogout={onLogout} />

      <header className="sticky top-0 z-30 px-3 pt-3 sm:px-6 sm:pt-4">
        <div className="glass mx-auto flex h-16 max-w-[1320px] items-center gap-4 rounded-[22px] px-4 sm:px-5">
          <Brand />
          <div className="flex flex-1 justify-center">
            <QuickSearch />
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/80 bg-white/60 px-3.5 py-2 text-[13px] font-medium text-ink-2 xl:flex">
            <Icon name="calendar" size={15} className="text-gold" />
            {today}
          </div>
          <Notifications />
          <button className="flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/60 text-ink-2 hover:bg-white lg:hidden" onClick={() => setOpen(true)} aria-label="Buka menu">
            <Icon name="menu" size={20} />
          </button>
        </div>
      </header>

      {open && (
        <div className="fixed inset-0 z-50 bg-ink/35 backdrop-blur-[3px] lg:hidden" onClick={() => setOpen(false)}>
          <div className="rail pop-in m-3 flex h-[calc(100%-1.5rem)] w-[270px] origin-left flex-col rounded-[26px] p-3" onClick={(e) => e.stopPropagation()}>
            <div className="px-3 pt-2 pb-3 text-[13px] font-semibold tracking-[0.14em] text-white/70 uppercase">Menu</div>
            <nav className="flex flex-col gap-1 overflow-y-auto">
              {NAV.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  onClick={() => setOpen(false)}
                  className={({ isActive }) =>
                    cx('flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14.5px] font-medium transition-colors', isActive ? 'bg-white text-navy' : 'text-white/75 hover:bg-white/10 hover:text-white')
                  }
                >
                  <Icon name={n.icon} size={18} />
                  {n.label}
                </NavLink>
              ))}
            </nav>
            <button onClick={onLogout} className="mt-auto flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-[14px] font-medium text-white/70 hover:bg-white/10 hover:text-white">
              <Icon name="logout" size={18} /> Keluar
            </button>
          </div>
        </div>
      )}

      <main key={pathname} className="page-in mx-auto max-w-[1320px] px-3 py-6 sm:px-6 sm:py-7">
        {children}
      </main>
    </div>
  )
}
