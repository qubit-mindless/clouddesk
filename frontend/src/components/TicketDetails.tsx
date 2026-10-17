import type { Ticket } from '../api/types'
import { formatDateTime } from '../utils/sla'
import { PriorityBadge } from './PriorityBadge'
import { SlaDue } from './SlaDue'
import { StatusBadge } from './StatusBadge'

export function TicketDetails({ ticket }: { ticket: Ticket }) {
  return (
    <article className="details" data-testid="ticket-details">
      <header>
        <h2>
          #{ticket.id} {ticket.title}
        </h2>
        <div className="details-badges">
          <PriorityBadge priority={ticket.priority} />
          <StatusBadge status={ticket.status} />
        </div>
      </header>
      <dl>
        <dt>Zgłaszający</dt>
        <dd>{ticket.reporter}</dd>
        <dt>Technik</dt>
        <dd>{ticket.assignee ?? 'nieprzypisane'}</dd>
        <dt>Utworzono</dt>
        <dd>{formatDateTime(ticket.createdAt)}</dd>
        <dt>Termin SLA</dt>
        <dd>
          <SlaDue ticket={ticket} />
        </dd>
      </dl>
      <h3>Opis</h3>
      <p className="details-description">{ticket.description}</p>
    </article>
  )
}
