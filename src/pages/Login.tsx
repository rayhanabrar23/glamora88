import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { Button, Input } from '../components/ui'
import { Icon } from '../components/Icon'

export default function Login({ onSuccess }: { onSuccess: () => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [accounts, setAccounts] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    api
      .get<{ accounts: boolean }>('/login-info')
      .then((r) => setAccounts(r.accounts))
      .catch(() => setAccounts(false))
  }, [])
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/login', { username: username.trim(), password })
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
          <img src="/logo.png" alt="Glamora88" className="mx-auto h-[150px] w-auto" />
          <p className="mt-4 text-[13px] tracking-[0.18em] text-white/60 uppercase">Portal Bisnis</p>
        </div>
        <form onSubmit={submit} className="glass page-in flex flex-col gap-4 rounded-3xl p-7">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <Icon name="users" size={14} /> Nama pengguna
            </span>
            <Input
              autoFocus
              autoComplete="username"
              autoCapitalize="none"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={accounts === false ? 'Kosongkan bila memakai kata sandi tim' : 'Contoh: tiara'}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-ink-2">
              <Icon name="lock" size={14} /> Kata sandi
            </span>
            <div className="relative">
              <Input
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="pr-11"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Masukkan kata sandi"
              />
              <button
                type="button"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Sembunyikan kata sandi' : 'Lihat kata sandi'}
                className="absolute top-1/2 right-2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted hover:text-navy"
              >
                <Icon name={show ? 'eyeOff' : 'eye'} size={17} />
              </button>
            </div>
          </label>
          {error && <p className="text-[13.5px] text-bad">{error}</p>}
          <Button type="submit" variant="primary" className="h-11 w-full" disabled={busy || !password || (accounts === true && !username.trim())}>
            {busy ? 'Memeriksa…' : 'Masuk'}
          </Button>
        </form>
      </div>
    </div>
  )
}
