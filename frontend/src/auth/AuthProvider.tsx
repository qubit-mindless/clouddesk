import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { ApiError } from '../api/client'
import { getMe, login as loginRequest } from '../api/auth'
import type { User } from '../api/types'
import { AuthContext, type AuthState } from '../hooks/useAuth'
import { clearToken, getToken, onSessionExpired, setToken } from './session'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [endReason, setEndReason] = useState<AuthState['endReason']>(null)
  // Z tokenem z poprzedniej wizyty najpierw pytamy backend, czy jest ważny i kim jest użytkownik.
  const [checking, setChecking] = useState(() => getToken() !== null)
  const [checkError, setCheckError] = useState<unknown>()

  useEffect(() => {
    if (!checking) return
    const controller = new AbortController()
    getMe(controller.signal).then(
      (me) => {
        setUser(me)
        setChecking(false)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        // 401 – token nieważny (klient API już go usunął). Inny błąd (sieć, restart backendu przy wdrożeniu)
        // nie unieważnia tokenu: zostawiamy go i pokazujemy „Spróbuj ponownie”.
        if (!(error instanceof ApiError && error.status === 401)) setCheckError(error)
        setChecking(false)
      },
    )
    return () => controller.abort()
  }, [checking])

  const retry = useCallback(() => {
    setCheckError(undefined)
    setChecking(true)
  }, [])

  // Token wygasł w trakcie pracy (401 z API): RequireAuth przenosi na ekran logowania z komunikatem.
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null)
        setEndReason('expired')
      }),
    [],
  )

  const login = useCallback(async (email: string, password: string) => {
    // Stary token (np. z sesji, której nie udało się sprawdzić) nie może iść z logowaniem: 401 za złe hasło
    // wyglądałby wtedy jak wygaśnięcie sesji.
    clearToken()
    const response = await loginRequest(email, password)
    setToken(response.accessToken)
    setUser(response.user)
    setEndReason(null)
  }, [])

  const logout = useCallback(() => {
    clearToken()
    setUser(null)
    setEndReason('logout')
  }, [])

  const status: AuthState['status'] = checking
    ? 'checking'
    : user
      ? 'authenticated'
      : checkError !== undefined
        ? 'unavailable'
        : 'anonymous'
  const value = useMemo<AuthState>(
    () => ({ status, user, endReason, checkError, retry, login, logout }),
    [status, user, endReason, checkError, retry, login, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
