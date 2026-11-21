import { ROLE_LABEL } from '../api/labels'
import { useAuth } from '../hooks/useAuth'

export function UserMenu() {
  // Po wylogowaniu RequireAuth sam przenosi na /login.
  const { user, logout } = useAuth()
  if (!user) return null

  return (
    <div className="user-menu" data-testid="user-menu">
      <span>
        <strong data-testid="user-name">{user.fullName}</strong>
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
