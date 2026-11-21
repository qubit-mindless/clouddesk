import { Link, Navigate, Outlet, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { ToastProvider } from './components/Toast'
import { UserMenu } from './components/UserMenu'
import { APP_VERSION } from './config'
import { useGlassPointer } from './hooks/useGlassPointer'
import { LoginPage } from './pages/LoginPage'
import { TicketDetailsPage } from './pages/TicketDetailsPage'
import { TicketEditPage } from './pages/TicketEditPage'
import { TicketListPage } from './pages/TicketListPage'
import { TicketNewPage } from './pages/TicketNewPage'

export default function App() {
  useGlassPointer()

  return (
    <ToastProvider>
      <AuthProvider>
        {/* Płynne gradientowe tło pod szklanymi taflami – tylko dekoracja. */}
        <div className="liquid" aria-hidden="true" />
        <main>
          <header className="app-header">
            <div>
              <h1>
                <Link to="/tickets">CloudDesk</Link>
              </h1>
              <p>System zgłoszeń IT z SLA i asystentem AI</p>
            </div>
            <UserMenu />
          </header>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route
              element={
                <RequireAuth>
                  <Outlet />
                </RequireAuth>
              }
            >
              <Route path="/" element={<Navigate to="/tickets" replace />} />
              <Route path="/tickets" element={<TicketListPage />} />
              <Route path="/tickets/new" element={<TicketNewPage />} />
              <Route path="/tickets/:id" element={<TicketDetailsPage />} />
              <Route path="/tickets/:id/edit" element={<TicketEditPage />} />
              <Route path="*" element={<Navigate to="/tickets" replace />} />
            </Route>
          </Routes>
          <footer className="app-footer">
            CloudDesk · wersja{' '}
            <code data-testid="app-version" title={APP_VERSION}>
              {APP_VERSION.slice(0, 7)}
            </code>
          </footer>
        </main>
      </AuthProvider>
    </ToastProvider>
  )
}
