import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
export { cx }

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[15px] leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Card({ title, subtitle, actions, children, className, padded = true }: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section className={cx('rounded-2xl border border-line bg-surface shadow-[0_1px_2px_rgba(27,35,51,0.04)]', className)}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-line-soft px-5 py-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'bad' | 'neutral' }) {
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-[0_1px_2px_rgba(27,35,51,0.04)]">
      <div className="text-[13px] font-medium text-muted">{label}</div>
      <div className={cx('num mt-1.5 text-[24px] font-semibold tracking-tight', tone === 'bad' ? 'text-bad' : tone === 'good' ? 'text-good' : 'text-ink')}>
        {value}
      </div>
      {hint && <div className="mt-1 text-[12.5px] leading-snug text-muted">{hint}</div>}
    </div>
  )
}

type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({
  variant = 'secondary',
  icon,
  children,
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant; icon?: string }) {
  const styles: Record<BtnVariant, string> = {
    primary: 'bg-navy text-white hover:bg-navy-2 border-navy',
    secondary: 'bg-surface text-ink border-line hover:border-gold hover:text-navy',
    ghost: 'bg-transparent text-ink-2 border-transparent hover:bg-line-soft',
    danger: 'bg-surface text-bad border-line hover:border-bad hover:bg-bad-soft',
  }
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex h-9 items-center justify-center gap-2 rounded-xl border px-3.5 text-[14px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className,
      )}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  )
}

export function IconButton({ icon, label, onClick, tone }: { icon: string; label: string; onClick: () => void; tone?: 'danger' }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors',
        tone === 'danger' ? 'hover:bg-bad-soft hover:text-bad' : 'hover:bg-line-soft hover:text-navy',
      )}
    >
      <Icon name={icon} size={16} />
    </button>
  )
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  )
}

const inputCls =
  'h-10 w-full rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none transition-colors placeholder:text-muted/70 focus:border-gold focus:ring-2 focus:ring-gold-soft'
export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(inputCls, props.className)} />
}
export function Select({ options, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { options: (string | { value: string; label: string })[] }) {
  return (
    <select {...props} className={cx(inputCls, 'pr-8', props.className)}>
      {options.map((o) =>
        typeof o === 'string' ? (
          <option key={o} value={o}>
            {o}
          </option>
        ) : (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ),
      )}
    </select>
  )
}
export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(inputCls, 'h-auto min-h-[80px] py-2', props.className)} />
}

const badgeTone = {
  good: 'bg-good-soft text-good',
  warn: 'bg-warn-soft text-warn',
  bad: 'bg-bad-soft text-bad',
  info: 'bg-info-soft text-info',
  neutral: 'bg-line-soft text-ink-2',
  gold: 'bg-gold-soft text-[#7a5c2b]',
}
export function Badge({ tone = 'neutral', children }: { tone?: keyof typeof badgeTone; children: ReactNode }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-[12px] font-medium', badgeTone[tone])}>{children}</span>
}

export function Modal({ open, title, onClose, children, footer, wide }: {
  open: boolean
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/30 p-4 backdrop-blur-[2px] sm:p-10" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx('w-full rounded-2xl border border-line bg-surface shadow-xl', wide ? 'max-w-4xl' : 'max-w-xl')}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line-soft px-6 py-4">
          <h3 className="text-[17px] font-semibold text-ink">{title}</h3>
          <IconButton icon="close" label="Tutup" onClick={onClose} />
        </div>
        <div className="px-6 py-5">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line-soft px-6 py-4">{footer}</div>}
      </div>
    </div>
  )
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line px-6 py-12 text-center">
      <div className="text-[15px] font-medium text-ink">{title}</div>
      {children && <div className="mt-1 max-w-md text-[14px] text-muted">{children}</div>}
    </div>
  )
}

export function Callout({ tone = 'info', title, children }: { tone?: 'good' | 'warning' | 'critical' | 'info'; title: string; children?: ReactNode }) {
  const t = {
    good: ['bg-good-soft', 'text-good', 'check'],
    warning: ['bg-warn-soft', 'text-warn', 'alert'],
    critical: ['bg-bad-soft', 'text-bad', 'alert'],
    info: ['bg-info-soft', 'text-info', 'info'],
  }[tone]
  return (
    <div className={cx('flex gap-3 rounded-xl px-4 py-3', t[0])}>
      <Icon name={t[2]} size={18} className={cx('mt-0.5 shrink-0', t[1])} />
      <div>
        <div className="text-[14px] font-semibold text-ink">{title}</div>
        {children && <div className="mt-0.5 text-[13.5px] leading-relaxed text-ink-2">{children}</div>}
      </div>
    </div>
  )
}

export function Table({ head, children, footer }: { head: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[14px]">
        <thead className="text-left text-[12.5px] font-medium text-muted">{head}</thead>
        <tbody className="[&>tr]:border-t [&>tr]:border-line-soft [&>tr:hover]:bg-canvas/60">{children}</tbody>
        {footer && <tfoot className="border-t border-line font-semibold">{footer}</tfoot>}
      </table>
    </div>
  )
}
export const th = 'whitespace-nowrap px-3 py-2.5 font-medium first:pl-5 last:pr-5'
export const td = 'px-3 py-2.5 first:pl-5 last:pr-5 align-middle'
export const tdNum = 'num px-3 py-2.5 text-right whitespace-nowrap first:pl-5 last:pr-5'

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: string }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-surface p-1">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={cx(
            'rounded-lg px-3.5 py-1.5 text-[14px] font-medium transition-colors',
            value === it.value ? 'bg-navy text-white' : 'text-ink-2 hover:text-navy',
          )}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}

// ---------- Notifikasi ----------
type Toast = { id: number; text: string; tone: 'good' | 'bad' }
const ToastCtx = createContext<(text: string, tone?: 'good' | 'bad') => void>(() => {})
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'good' | 'bad' = 'good') => {
    const id = Date.now() + Math.random()
    setItems((x) => [...x, { id, text, tone }])
    setTimeout(() => setItems((x) => x.filter((t) => t.id !== id)), 4000)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[60] flex flex-col gap-2" aria-live="polite">
        {items.map((t) => (
          <div
            key={t.id}
            className={cx(
              'flex items-center gap-2 rounded-xl border px-4 py-3 text-[14px] shadow-lg',
              t.tone === 'good' ? 'border-good/20 bg-surface text-ink' : 'border-bad/30 bg-bad-soft text-bad',
            )}
          >
            <Icon name={t.tone === 'good' ? 'check' : 'alert'} size={16} className={t.tone === 'good' ? 'text-good' : 'text-bad'} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}
export const useToast = () => useContext(ToastCtx)

export function confirmDelete(what: string) {
  return window.confirm(`Hapus ${what}? Tindakan ini tidak bisa dibatalkan.`)
}

export function Loading() {
  return (
    <div className="flex items-center gap-3 py-16 text-muted">
      <span className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-gold" />
      Memuat data…
    </div>
  )
}
export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Callout tone="critical" title="Data gagal dimuat">
      {message}{' '}
      {onRetry && (
        <button className="font-medium underline" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </Callout>
  )
}
