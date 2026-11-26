import { Link } from 'react-router'
import { ROLE_LABEL } from '../api/labels'
import { useAuth } from '../hooks/useAuth'

export function UserMenu() {
  // Po wylogowaniu RequireAuth sam przenosi na /login.
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="user-menu" data-testid="user-menu">
      <span>
        {/* Imię i nazwisko prowadzi do konta – tam zmiana własnego hasła. */}
        <Link to="/account" className="user-name" data-testid="user-name" title="Moje konto – zmiana hasła">
          {user.fullName}
        </Link>
        <span className="user-role" data-testid="user-role">
          {ROLE_LABEL[user.role]}
        </span>
      </span>
      <button
        type="button"
        data-testid="logout"
        onClick={logout}
      >
        Wyloguj
      </button>
    </div>
  )
}
