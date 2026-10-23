import { useNavigate } from 'react-router'
import { createTicket } from '../api/tickets'
import type { TicketCreate } from '../api/types'
import { TicketForm } from '../components/TicketForm'
import { useToast } from '../hooks/useToast'

export function TicketNewPage() {
  const navigate = useNavigate()
  const toast = useToast()

  return (
    <section className="details">
      <h2>Nowe zgłoszenie</h2>
      <TicketForm
        submitLabel="Utwórz zgłoszenie"
        onCancel={() => navigate('/tickets')}
        onSubmit={async (data) => {
          const ticket = await createTicket(data as TicketCreate)
          toast(`Utworzono zgłoszenie #${ticket.id}.`)
          navigate(`/tickets/${ticket.id}`, { replace: true })
        }}
      />
    </section>
  )
}
