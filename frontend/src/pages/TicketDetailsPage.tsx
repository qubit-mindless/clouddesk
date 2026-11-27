import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { ApiError, errorMessage } from '../api/client'
import type { Ticket } from '../api/types'
import { deleteTicket, getTicket } from '../api/tickets'
import { AssistantPanel } from '../components/AssistantPanel'
import { canDeleteTicket, canEditTicket } from '../auth/permissions'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { TicketDetails } from '../components/TicketDetails'
import { TicketTimeline } from '../components/TicketTimeline'
import { useAuth } from '../hooks/useAuth'
import { useRequest } from '../hooks/useRequest'
import { useToast } from '../hooks/useToast'

export function TicketDetailsPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const location = useLocation()
  const locationState = location.state as { listSearch?: string; justCreated?: boolean } | null
  const listSearch = locationState?.listSearch ?? ''
  // „Właśnie utworzone” zużywamy raz: zapamiętujemy przy wejściu i czyścimy w historii, żeby odświeżenie strony
  // nie wysyłało ponownie automatycznego pytania do asystenta (każde zużywa limit).
  const [autoSuggest] = useState(locationState?.justCreated === true)
  useEffect(() => {
    if (locationState?.justCreated) navigate(location.pathname, { replace: true, state: { listSearch } })
  }, [locationState?.justCreated, location.pathname, listSearch, navigate])
  const { data: loaded, error, loading, reload } = useRequest(id, (signal) => getTicket(Number(id), signal))
  // Po „Pomogło – zamknij” podmieniamy zgłoszenie odpowiedzią z /resolve – bez migania strony ładowaniem.
  const [resolved, setResolved] = useState<Ticket>()
  const ticket = resolved && loaded && resolved.id === loaded.id ? resolved : loaded
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
        <Link to={`/tickets${listSearch}`} className="button" data-testid="ticket-back">
          ← Wróć do listy
        </Link>
        {ticket && (
          <div className="page-actions-group">
            {canEditTicket(user, ticket) && (
              <Link to={`/tickets/${ticket.id}/edit`} state={{ listSearch }} className="button" data-testid="ticket-edit">
                Edytuj
              </Link>
            )}
            {canDeleteTicket(user) && (
              <button type="button" className="danger" onClick={handleDelete} disabled={deleting} data-testid="ticket-delete">
                {deleting ? 'Usuwanie…' : 'Usuń'}
              </button>
            )}
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
      {ticket && <TicketTimeline ticket={ticket} />}
      {ticket && (
        <AssistantPanel ticketId={ticket.id} reporter={ticket.reporter} autoSuggest={autoSuggest} onResolved={setResolved} />
      )}
    </>
  )
}
