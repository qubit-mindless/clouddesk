import { Link, useLocation, useParams } from 'react-router'
import { getTicket } from '../api/tickets'
import { TicketDetails } from '../components/TicketDetails'

export function TicketDetailsPage() {
  const { id } = useParams()
  const ticket = getTicket(Number(id))
  const listSearch = (useLocation().state as { listSearch?: string } | null)?.listSearch ?? ''

  return (
    <>
      <Link to={`/tickets${listSearch}`} data-testid="ticket-back">
        ← Wróć do listy
      </Link>
      {ticket ? (
        <TicketDetails ticket={ticket} />
      ) : (
        <p className="empty" data-testid="ticket-not-found">
          Nie znaleziono zgłoszenia #{id}.
        </p>
      )}
    </>
  )
}
