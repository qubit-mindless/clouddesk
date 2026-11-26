import { NavLink } from 'react-router'
import { canManageTicket, isAdmin } from '../auth/permissions'
import { useAuth } from '../hooks/useAuth'

// Nawigacja w nagłówku. Pulpit SLA widzą tylko technik i administrator, więc zgłaszający nie dostaje menu wcale;
// „Użytkownicy” (konta) – tylko administrator.
export function AppNav() {
  const { user } = useAuth()
  if (!canManageTicket(user)) return null

  return (
    <nav className="app-nav" aria-label="Główna">
      <NavLink to="/tickets" data-testid="nav-tickets">
        Zgłoszenia
      </NavLink>
      <NavLink to="/dashboard" data-testid="nav-dashboard">
        Pulpit
      </NavLink>
      {isAdmin(user) && (
        <NavLink to="/users" data-testid="nav-users">
          Użytkownicy
        </NavLink>
      )}
    </nav>
  )
}
