import { useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { api } from './lib/api'
import { Layout } from './components/Layout'
import { Loading, ToastProvider } from './components/ui'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Sales from './pages/Sales'
import Purchases from './pages/Purchases'
import Products from './pages/Products'
import Boosts from './pages/Boosts'
import Live from './pages/Live'
import Projection from './pages/Projection'
import Settlement from './pages/Settlement'
import Reports from './pages/Reports'
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'
import Kpi from './pages/Kpi'
import Agenda from './pages/Agenda'
import Qr, { QrSku } from './pages/Qr'
import { MeContext, type Me } from './lib/me'

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')
  const [me, setMe] = useState<{ user: Me | null; accounts: boolean }>({ user: null, accounts: false })
  const check = () =>
    api
      .get<{ user: Me; accounts: boolean }>('/me')
      .then((r) => {
        setMe({ user: r.user, accounts: r.accounts })
        setAuth('in')
      })
      .catch(() => setAuth('out'))
  useEffect(() => {
    check()
    const h = () => setAuth('out')
    window.addEventListener('g88:unauthorized', h)
    return () => window.removeEventListener('g88:unauthorized', h)
  }, [])
  async function logout() {
    await api.post('/logout').catch(() => {})
    setAuth('out')
  }
  return (
    <ToastProvider>
      {auth === 'checking' ? (
        <div className="mx-auto max-w-[1320px] px-6 py-10">
          <Loading />
        </div>
      ) : auth === 'out' ? (
        <Login onSuccess={check} />
      ) : (
        <MeContext.Provider value={me}>
        <BrowserRouter>
          <Layout onLogout={logout}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/penjualan" element={<Sales />} />
              <Route path="/pencairan" element={<Settlement />} />
              <Route path="/pembelian" element={<Purchases />} />
              <Route path="/produk" element={<Products />} />
              <Route path="/live" element={<Live />} />
              <Route path="/boost" element={<Boosts />} />
              <Route path="/biaya" element={<Expenses />} />
              <Route path="/proyeksi" element={<Projection />} />
              <Route path="/laporan" element={<Reports />} />
              <Route path="/kpi" element={<Kpi />} />
              <Route path="/agenda" element={<Agenda />} />
              <Route path="/qr" element={<Qr />} />
              <Route path="/qr/:sku" element={<QrSku />} />
              <Route path="/pengaturan" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
        </MeContext.Provider>
      )}
    </ToastProvider>
  )
}
