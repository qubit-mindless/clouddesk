import { createContext, useContext } from 'react'
import type { User } from '../api/types'

export interface AuthState {
  // checking – sprawdzamy token z poprzedniej wizyty (GET /auth/me);
  // unavailable – backend nie odpowiedział (sieć, 5xx), token zostaje i można spróbować ponownie.
  status: 'checking' | 'unavailable' | 'anonymous' | 'authenticated'
  user: User | null
  // Dlaczego sesja się skończyła: po „Wyloguj” nie wracamy na stronę poprzedniego użytkownika,
  // a po wygaśnięciu tokenu ekran logowania mówi, co się stało.
  endReason: 'logout' | 'expired' | null
  checkError: unknown
  retry: () => void
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

export const AuthContext = createContext<AuthState>({
  status: 'anonymous',
  user: null,
  endReason: null,
  checkError: undefined,
  retry: () => {},
  login: async () => {},
  logout: () => {},
})

export function useAuth(): AuthState {
  return useContext(AuthContext)
}
