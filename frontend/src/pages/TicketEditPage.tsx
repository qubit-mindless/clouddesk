import { useLocation, useNavigate, useParams } from 'react-router'
import { ApiError } from '../api/client'
import { getTicket, updateTicket } from '../api/tickets'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { TicketForm } from '../components/TicketForm'
import { useToast } from '../hooks/useToast'
import { useRequest } from '../hooks/useRequest'

export function TicketEditPage() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  // Po zapisie wracamy do szczegółów z tym samym stanem, żeby „Wróć do listy” pamiętał filtry.
  const { state } = useLocation()
  const { data: ticket, error, loading, reload } = useRequest(id, (signal) => getTicket(Number(id), signal))
  const backToDetails = () => navigate(`/tickets/${id}`, { state, replace: true })

  if (loading) return <Loading label="Ładowanie zgłoszenia…" />
  if (error instanceof ApiError && error.status === 404) {
    return (
      <p className="empty" data-testid="ticket-not-found">
        Nie znaleziono zgłoszenia #{id}.
      </p>
    )
  }
  if (!ticket) return <ErrorState error={error} onRetry={reload} />

  return (
    <section className="details">
      <h2>Edycja zgłoszenia #{ticket.id}</h2>
      <TicketForm
        ticket={ticket}
        submitLabel="Zapisz zmiany"
        onCancel={backToDetails}
        onSubmit={async (data) => {
          if (Object.keys(data).length > 0) {
            await updateTicket(ticket.id, data)
            toast(`Zapisano zgłoszenie #${ticket.id}.`)
          }
          backToDetails()
        }}
      />
    </section>
  )
}
