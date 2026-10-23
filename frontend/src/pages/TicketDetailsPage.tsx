import { Link, useLocation, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { getTicket } from '../api/tickets'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { TicketDetails } from '../components/TicketDetails'
import { useRequest } from '../hooks/useRequest'

export function TicketDetailsPage() {
  const { id = '' } = useParams()
  const listSearch = (useLocation().state as { listSearch?: string } | null)?.listSearch ?? ''
  const { data: ticket, error, loading, reload } = useRequest(id, (signal) => getTicket(Number(id), signal))
  const notFound = error instanceof ApiError && error.status === 404

  return (
    <>
      <div className="page-actions">
        <Link to={`/tickets${listSearch}`} data-testid="ticket-back">
          ← Wróć do listy
        </Link>
        {ticket && (
          <Link to={`/tickets/${ticket.id}/edit`} state={{ listSearch }} className="button" data-testid="ticket-edit">
            Edytuj
          </Link>
        )}
      </div>
      {loading && <Loading label="Ładowanie zgłoszenia…" />}
      {notFound && (
        <p className="empty" data-testid="ticket-not-found">
          Nie znaleziono zgłoszenia #{id}.
        </p>
      )}
      {error !== undefined && !notFound && <ErrorState error={error} onRetry={reload} />}
      {ticket && <TicketDetails ticket={ticket} />}
    </>
  )
}
