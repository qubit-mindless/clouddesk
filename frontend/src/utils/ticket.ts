import type { Ticket } from '../api/types'

// Rozwiązane albo zamknięte: termin SLA już nie obowiązuje, zgłaszający nie edytuje, „Przejmij” znika.
export function isClosed(ticket: Pick<Ticket, 'status'>): boolean {
  return ticket.status === 'RESOLVED' || ticket.status === 'CLOSED'
}
