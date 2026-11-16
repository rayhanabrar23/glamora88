import { useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { useData } from '../lib/useData'
import { Button, Callout, Card, Field, Input, Loading, Modal, PageHeader } from './ui'
import { Icon } from './Icon'

/** Membungkus halaman khusus owner: minta kata sandi owner sebelum isi ditampilkan. */
export function OwnerGate({ title, children }: { title: string; children: ReactNode }) {
  const { data, reload } = useData<{ owner: boolean; configured: boolean }>('/owner')
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  if (!data) return <Loading />
  if (data.owner) return <>{children}</>
  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api.post('/owner/login', { password: pw })
      setPw('')
      reload()
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <PageHeader title={title} />
      <div className="mx-auto mt-6 max-w-[440px]">
        <Card>
          <div className="flex flex-col items-center text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-navy text-white">
              <Icon name="lock" size={22} />
            </span>
            <div className="mt-3 text-[17px] font-semibold text-ink">Khusus owner</div>
            <p className="mt-1 text-[13.5px] text-muted">Masukkan kata sandi owner untuk membuka halaman ini. Kunci terbuka 8 jam di perangkat ini.</p>
          </div>
          {!data.configured ? (
            <div className="mt-4">
              <Callout tone="warning" title="Kata sandi owner belum diatur">
                Tambahkan secret OWNER_PASSWORD di Cloudflare (Workers › glamora88 › Settings › Variables and Secrets).
              </Callout>
            </div>
          ) : (
            <form className="mt-4 flex flex-col gap-3" onSubmit={unlock}>
              <Field label="Kata sandi owner">
                <Input type="password" autoComplete="current-password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus />
              </Field>
              {err && <p className="text-[13px] text-bad">{err}</p>}
              <Button variant="primary" type="submit" disabled={!pw || busy}>
                {busy ? 'Memeriksa…' : 'Buka kunci'}
              </Button>
            </form>
          )}
        </Card>
      </div>
    </>
  )
}

/** Tombol buka kunci owner di dalam halaman biasa (mis. untuk melihat gaji & komisi). */
export function OwnerUnlockButton({ onUnlocked, label = 'Buka sebagai owner' }: { onUnlocked: () => void; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pw, setPw] = useState('')
  const [err, setErr] = useState('')
  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    setErr('')
    try {
      await api.post('/owner/login', { password: pw })
      setOpen(false)
      setPw('')
      onUnlocked()
    } catch (x) {
      setErr((x as Error).message)
    }
  }
  return (
    <>
      <Button icon="lock" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && (
        <Modal open title="Buka kunci owner" onClose={() => setOpen(false)}>
          <form className="flex flex-col gap-3" onSubmit={unlock}>
            <Field label="Kata sandi owner">
              <Input type="password" autoComplete="current-password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />
            </Field>
            {err && <p className="text-[13px] text-bad">{err}</p>}
            <Button variant="primary" type="submit" disabled={!pw}>
              Buka kunci
            </Button>
          </form>
        </Modal>
      )}
    </>
  )
}

export async function lockOwner() {
  await api.post('/owner/logout', {})
  window.location.reload()
}
