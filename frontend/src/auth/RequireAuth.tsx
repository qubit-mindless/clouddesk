import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { useAuth } from '../hooks/useAuth'

// Dokąd wrócić po zalogowaniu: ścieżka z parametrami i stan strony (np. zapamiętane filtry listy).
export interface ReturnTo {
  path: string
  state: unknown
}

// Trasy tylko dla zalogowanych. Niezalogowany trafia na /login, a po zalogowaniu wraca tam, gdzie chciał wejść
// (także po wygaśnięciu sesji). Po „Wyloguj” następna osoba zaczyna od listy zgłoszeń.
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, endReason, checkError, retry } = useAuth()
  const location = useLocation()

  if (status === 'checking') return <Loading label="Sprawdzanie sesji…" />
  if (status === 'unavailable') return <ErrorState error={checkError} onRetry={retry} />
  if (status === 'anonymous') {
    const from: ReturnTo | undefined =
      endReason === 'logout' ? undefined : { path: location.pathname + location.search, state: location.state }
    return <Navigate to="/login" replace state={{ from }} />
  }
  return children
}
