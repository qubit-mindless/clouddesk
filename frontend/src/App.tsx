import { Link, Navigate, Route, Routes } from 'react-router'
import { TicketDetailsPage } from './pages/TicketDetailsPage'
import { TicketListPage } from './pages/TicketListPage'

export default function App() {
  return (
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
        <Route path="/tickets/:id" element={<TicketDetailsPage />} />
        <Route path="*" element={<Navigate to="/tickets" replace />} />
      </Routes>
    </main>
  )
}
