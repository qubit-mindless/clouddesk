import type { Ticket } from '../api/types'
import { formatDateTime } from '../utils/time'
import { personLabel } from '../utils/user'
import { PriorityBadge } from './PriorityBadge'
import { useNow } from '../hooks/useNow'
import { SlaDue, SlaProgress } from './SlaDue'
import { StatusBadge } from './StatusBadge'

export function TicketDetails({ ticket }: { ticket: Ticket }) {
  const now = useNow(30_000)
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
        <dd>{personLabel(ticket.reporterName, ticket.reporter)}</dd>
        <dt>Technik</dt>
        <dd>{ticket.assignee ? personLabel(ticket.assigneeName, ticket.assignee) : 'nieprzypisane'}</dd>
        <dt>Utworzono</dt>
        <dd>{formatDateTime(ticket.createdAt)}</dd>
        <dt>Termin SLA</dt>
        <dd className="sla-cell">
          <span>
            <SlaDue ticket={ticket} now={now} /> <span className="sla-date">{formatDateTime(ticket.slaDueAt)}</span>
          </span>
          <SlaProgress ticket={ticket} now={now} />
        </dd>
      </dl>
      <h3>Opis</h3>
      <p className="details-description">{ticket.description}</p>
    </article>
  )
}
