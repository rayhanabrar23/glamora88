import { useState, type ReactNode } from 'react'
import { NavLink } from 'react-router-dom'
import { Icon } from './Icon'
import { cx } from './ui'

const NAV = [
  { to: '/', label: 'Ringkasan', icon: 'dashboard', end: true },
  { to: '/penjualan', label: 'Penjualan', icon: 'sales' },
  { to: '/pembelian', label: 'Pembelian & Impor', icon: 'purchase' },
  { to: '/produk', label: 'Produk & Stok', icon: 'product' },
  { to: '/boost', label: 'Boost & Promosi', icon: 'boost' },
  { to: '/biaya', label: 'Biaya Operasional', icon: 'expense' },
  { to: '/pengaturan', label: 'Pengaturan', icon: 'settings' },
]

function Brand() {
  return (
    <div className="flex items-center gap-3 px-2">
      <img src="/logo-mark.png" alt="Glamora88" className="h-11 w-11 object-contain" />
      <div>
        <div className="text-[16px] leading-none font-semibold tracking-[0.12em] text-[#a8843f] uppercase">Glamora.id</div>
        <div className="mt-1 text-[11.5px] tracking-[0.14em] text-muted uppercase">Portal Bisnis</div>
      </div>
    </div>
  )
}

export function Layout({ children, onLogout }: { children: ReactNode; onLogout: () => void }) {
  const [open, setOpen] = useState(false)
  const nav = (
    <nav className="mt-8 flex flex-col gap-1">
      {NAV.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          end={n.end}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cx(
              'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14.5px] font-medium transition-colors',
              isActive ? 'bg-gold-soft text-navy' : 'text-ink-2 hover:bg-line-soft hover:text-navy',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive && <span className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full bg-gold" />}
              <Icon name={n.icon} size={18} className={isActive ? 'text-gold' : 'text-muted group-hover:text-navy'} />
              {n.label}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
  return (
    <div className="min-h-full lg:pl-[260px]">
      <aside className="fixed inset-y-0 left-0 hidden w-[260px] flex-col border-r border-line bg-surface px-4 py-6 lg:flex">
        <Brand />
        {nav}
        <button
          onClick={onLogout}
          className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium text-muted transition-colors hover:bg-line-soft hover:text-navy"
        >
          <Icon name="logout" size={18} /> Keluar
        </button>
      </aside>

      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <Brand />
        <button className="rounded-lg p-2 text-ink-2 hover:bg-line-soft" onClick={() => setOpen(true)} aria-label="Buka menu">
          <Icon name="menu" size={22} />
        </button>
      </header>
      {open && (
        <div className="fixed inset-0 z-40 bg-ink/30 lg:hidden" onClick={() => setOpen(false)}>
          <div className="flex h-full w-[280px] flex-col bg-surface px-4 py-6" onClick={(e) => e.stopPropagation()}>
            <Brand />
            {nav}
            <button onClick={onLogout} className="mt-auto flex items-center gap-3 rounded-xl px-3 py-2.5 text-[14px] font-medium text-muted">
              <Icon name="logout" size={18} /> Keluar
            </button>
          </div>
        </div>
      )}

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  )
}
