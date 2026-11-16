import { createContext, useContext } from 'react'

export interface Me {
  id: number
  name: string
  role: string
}
export const MeContext = createContext<{ user: Me | null; accounts: boolean }>({ user: null, accounts: false })
export const useMe = () => useContext(MeContext)
