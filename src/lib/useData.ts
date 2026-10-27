import { useCallback, useEffect, useState } from 'react'
import { api } from './api'

export function useData<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    if (!path) return
    setLoading(true)
    setError(null)
    try {
      setData(await api.get<T>(path))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [path])
  useEffect(() => {
    load()
  }, [load])
  // semua data dimuat ulang setelah ada penyimpanan (event global)
  useEffect(() => {
    const h = () => load()
    window.addEventListener('g88:refresh', h)
    return () => window.removeEventListener('g88:refresh', h)
  }, [load])
  return { data, error, loading, reload: load, setData }
}
