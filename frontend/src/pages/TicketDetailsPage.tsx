import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../api/client'
import { deleteTicket, getTicket } from '../api/tickets'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { TicketDetails } from '../components/TicketDetails'
import { useRequest } from '../hooks/useRequest'
import { useToast } from '../hooks/useToast'

export function TicketDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const listSearch = (useLocation().state as { listSearch?: string } | null)?.listSearch ?? ''
  const { data: ticket, error, loading, reload } = useRequest(id, (signal) => getTicket(Number(id), signal))
  const [deleting, setDeleting] = useState(false)
  const notFound = error instanceof ApiError && error.status === 404

  const handleDelete = async () => {
    if (!ticket || !window.confirm(`Usunąć zgłoszenie #${ticket.id}? Tej operacji nie da się cofnąć.`)) return
    setDeleting(true)
    try {
      await deleteTicket(ticket.id)
      toast(`Usunięto zgłoszenie #${ticket.id}.`)
    } catch (error) {
      // 404 znaczy, że ktoś usunął je wcześniej – efekt jest ten sam, więc też wracamy do listy.
      if (!(error instanceof ApiError && error.status === 404)) {
        toast(errorMessage(error), 'error')
        setDeleting(false)
        return
      }
      toast(`Zgłoszenie #${ticket.id} zostało już usunięte.`)
    }
    navigate(`/tickets${listSearch}`, { replace: true })
  }

  return (
    <>
      <div className="page-actions">
        <Link to={`/tickets${listSearch}`} data-testid="ticket-back">
          ← Wróć do listy
        </Link>
        {ticket && (
          <div className="page-actions-group">
            <Link to={`/tickets/${ticket.id}/edit`} state={{ listSearch }} className="button" data-testid="ticket-edit">
              Edytuj
            </Link>
            <button type="button" className="danger" onClick={handleDelete} disabled={deleting} data-testid="ticket-delete">
              {deleting ? 'Usuwanie…' : 'Usuń'}
            </button>
          </div>
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
