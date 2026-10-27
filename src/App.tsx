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
import Expenses from './pages/Expenses'
import Settings from './pages/Settings'

export default function App() {
  const [auth, setAuth] = useState<'checking' | 'in' | 'out'>('checking')
  useEffect(() => {
    api
      .get('/me')
      .then(() => setAuth('in'))
      .catch(() => setAuth('out'))
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
        <div className="flex h-full items-center justify-center">
          <Loading />
        </div>
      ) : auth === 'out' ? (
        <Login onSuccess={() => setAuth('in')} />
      ) : (
        <BrowserRouter>
          <Layout onLogout={logout}>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/penjualan" element={<Sales />} />
              <Route path="/pembelian" element={<Purchases />} />
              <Route path="/produk" element={<Products />} />
              <Route path="/live" element={<Live />} />
              <Route path="/boost" element={<Boosts />} />
              <Route path="/biaya" element={<Expenses />} />
              <Route path="/pengaturan" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        </BrowserRouter>
      )}
    </ToastProvider>
  )
}
