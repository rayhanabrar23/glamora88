import { createContext, useContext } from 'react'

export interface Me {
  id: number
  name: string
  role: string
  username?: string | null
  /** URL foto profil (sudah termasuk versi untuk cache) */
  photo?: string | null
}
export const MeContext = createContext<{ user: Me | null; accounts: boolean; refresh: () => void }>({ user: null, accounts: false, refresh: () => {} })
export const useMe = () => useContext(MeContext)
