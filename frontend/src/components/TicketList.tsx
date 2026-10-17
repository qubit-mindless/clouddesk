import { Link, useLocation, useNavigate } from 'react-router'
import type { Ticket } from '../api/types'
import { PriorityBadge } from './PriorityBadge'
import { SlaDue } from './SlaDue'
import { StatusBadge } from './StatusBadge'

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  const navigate = useNavigate()
  // Szczegóły dostają aktualne filtry, żeby przycisk powrotu wrócił do tego samego widoku.
  const { search } = useLocation()
  const state = { listSearch: search }

  if (tickets.length === 0) {
    return (
      <p className="empty" data-testid="ticket-list-empty">
        Brak zgłoszeń spełniających kryteria.
      </p>
    )
  }

  return (
    <div className="table-wrap">
      <table data-testid="ticket-list">
        <thead>
          <tr>
            <th>#</th>
            <th>Tytuł</th>
            <th>Priorytet</th>
            <th>Status</th>
            <th>Technik</th>
            <th>Termin SLA</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} data-testid={`ticket-row-${t.id}`} className="clickable" onClick={() => navigate(`/tickets/${t.id}`, { state })}>
              <td>{t.id}</td>
              <td>
                {/* Link zostaje dla klawiatury i czytników ekranu, kliknięcie w wiersz to skrót dla myszy. */}
                <Link to={`/tickets/${t.id}`} state={state} onClick={(e) => e.stopPropagation()}>
                  {t.title}
                </Link>
              </td>
              <td>
                <PriorityBadge priority={t.priority} />
              </td>
              <td>
                <StatusBadge status={t.status} />
              </td>
              <td>{t.assignee ?? '—'}</td>
              <td>
                <SlaDue ticket={t} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
