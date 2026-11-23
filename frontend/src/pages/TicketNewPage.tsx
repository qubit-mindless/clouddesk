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
      <h2>Zgłoś problem</h2>
      <p className="muted">Po wysłaniu asystent AI od razu podpowie, co możesz sprawdzić, zanim technik przejmie zgłoszenie.</p>
      <TicketForm
        submitLabel="Wyślij zgłoszenie"
        onCancel={() => navigate('/tickets')}
        onSubmit={async (data) => {
          const ticket = await createTicket(data as TicketCreate)
          toast(`Utworzono zgłoszenie #${ticket.id}.`)
          // Na stronie zgłoszenia asystent AI od razu proponuje, co sprawdzić (autoSuggest).
          navigate(`/tickets/${ticket.id}`, { replace: true, state: { justCreated: true } })
        }}
      />
    </section>
  )
}
