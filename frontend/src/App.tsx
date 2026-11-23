import { Link, Navigate, Outlet, Route, Routes, useLocation } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { AppNav } from './components/AppNav'
import { NotificationBell } from './components/NotificationBell'
import { ToastProvider } from './components/Toast'
import { UserMenu } from './components/UserMenu'
import { APP_VERSION } from './config'
import { useBackgroundAnimation } from './hooks/useBackgroundAnimation'
import { useAuth } from './hooks/useAuth'
import { useGlassPointer } from './hooks/useGlassPointer'
import { DashboardPage } from './pages/DashboardPage'
import { LoginPage } from './pages/LoginPage'
import { MyTicketsPage } from './pages/MyTicketsPage'
import { StatusPage } from './pages/StatusPage'
import { TicketDetailsPage } from './pages/TicketDetailsPage'
import { TicketEditPage } from './pages/TicketEditPage'
import { TicketListPage } from './pages/TicketListPage'
import { TicketNewPage } from './pages/TicketNewPage'

// Zgłaszający widzi swoje zgłoszenia jako karty, technik i administrator – tabelę z filtrami.
function TicketsHome() {
  const { user } = useAuth()
  return user?.role === 'REPORTER' ? <MyTicketsPage /> : <TicketListPage />
}

function HeaderActions() {
  const { user } = useAuth()
  if (!user) return null
  return (
    <div className="header-actions">
      <NotificationBell />
      <UserMenu />
    </div>
  )
}

export default function App() {
  const onLogin = useLocation().pathname === '/login'
  useGlassPointer()
  const [backgroundAnimation, toggleBackgroundAnimation] = useBackgroundAnimation()

  return (
    <ToastProvider>
      <AuthProvider>
        {/* Animowane tło pod szklanymi taflami – tylko dekoracja. */}
        <div className="liquid" aria-hidden="true">
          <span className="blob blob-1" />
          <span className="blob blob-2" />
          <span className="blob blob-3" />
          <span className="blob blob-4" />
        </div>
        <main>
          <header className="app-header" hidden={onLogin}>
            <div>
              <h1>
                <Link to="/tickets">CloudDesk</Link>
              </h1>
              <p>System zgłoszeń IT z SLA i asystentem AI</p>
            </div>
            <AppNav />
            <HeaderActions />
          </header>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            {/* Publiczna – stan wdrożenia bez logowania (#140). */}
            <Route path="/status" element={<StatusPage />} />
            <Route
              element={
                <RequireAuth>
                  <Outlet />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Navigate to="/tickets" replace />} />
              <Route path="/tickets" element={<TicketsHome />} />
              <Route path="/tickets/new" element={<TicketNewPage />} />
              <Route path="/tickets/:id" element={<TicketDetailsPage />} />
              <Route path="/tickets/:id/edit" element={<TicketEditPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="*" element={<Navigate to="/tickets" replace />} />
            </Route>
          </Routes>
          <footer className="app-footer">
            <span>
              CloudDesk · wersja{' '}
              <code data-testid="app-version" title={APP_VERSION}>
                {APP_VERSION.slice(0, 7)}
              </code>
              {' · '}
              <Link to="/status" data-testid="footer-status">
                Stan systemu
              </Link>
            </span>
            <button
              type="button"
              className="background-toggle"
              aria-pressed={backgroundAnimation}
              onClick={toggleBackgroundAnimation}
              data-testid="background-toggle"
            >
              Animacja tła <span aria-hidden="true">{backgroundAnimation ? 'wł.' : 'wył.'}</span>
            </button>
          </footer>
        </main>
      </AuthProvider>
    </ToastProvider>
  )
}
