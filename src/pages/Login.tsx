import { useState } from 'react'
import { api } from '../lib/api'
import { Button, Input } from '../components/ui'
import { Icon } from '../components/Icon'

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/login', { password })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-[400px]">
        <div className="mb-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-navy font-display text-[26px] text-[#d8b878]">88</div>
          <h1 className="mt-5 font-display text-[30px] text-navy">Glamora</h1>
          <p className="mt-1 text-[14px] tracking-[0.14em] text-muted uppercase">Portal Bisnis</p>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-7 shadow-[0_8px_30px_rgba(27,35,51,0.06)]">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <Icon name="lock" size={14} /> Kata sandi tim
            </span>
            <Input type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Masukkan kata sandi" />
          </label>
          {error && <p className="mt-3 text-[13.5px] text-bad">{error}</p>}
          <Button type="submit" variant="primary" className="mt-5 h-11 w-full" disabled={busy || !password}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </Button>
        </form>
        <p className="mt-6 text-center text-[12.5px] text-muted">Hanya untuk tim internal Glamora88.</p>
      </div>
    </div>
  )
}
