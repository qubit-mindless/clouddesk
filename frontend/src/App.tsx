import { Link, Navigate, Route, Routes } from 'react-router'
import { ToastProvider } from './components/Toast'
import { APP_VERSION } from './config'
import { TicketDetailsPage } from './pages/TicketDetailsPage'
import { TicketEditPage } from './pages/TicketEditPage'
import { TicketListPage } from './pages/TicketListPage'
import { TicketNewPage } from './pages/TicketNewPage'

export default function App() {
  return (
    <ToastProvider>
      <main>
        <header className="app-header">
          <h1>
            <Link to="/tickets">CloudDesk</Link>
          </h1>
          <p>System zgłoszeń IT z SLA i asystentem AI</p>
        </header>
        <Routes>
          <Route path="/" element={<Navigate to="/tickets" replace />} />
          <Route path="/tickets" element={<TicketListPage />} />
          <Route path="/tickets/new" element={<TicketNewPage />} />
          <Route path="/tickets/:id" element={<TicketDetailsPage />} />
          <Route path="/tickets/:id/edit" element={<TicketEditPage />} />
          <Route path="*" element={<Navigate to="/tickets" replace />} />
        </Routes>
        <footer className="app-footer">
          CloudDesk · wersja{' '}
          <code data-testid="app-version" title={APP_VERSION}>
            {APP_VERSION.slice(0, 7)}
          </code>
        </footer>
      </main>
    </ToastProvider>
  )
}
