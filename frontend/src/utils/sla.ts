import type { Ticket } from '../api/types'

// done: zgłoszenie rozwiązane lub zamknięte, termin już nie obowiązuje
// breached: termin minął, warning: zostało mniej niż WARNING_RATIO czasu na reakcję
export type SlaState = 'done' | 'ok' | 'warning' | 'breached'

const WARNING_RATIO = 0.25

export function getSlaState(ticket: Ticket, now: Date = new Date()): SlaState {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return 'done'

  const created = Date.parse(ticket.createdAt)
  const due = Date.parse(ticket.slaDueAt)
  const remaining = due - now.getTime()

  if (remaining <= 0) return 'breached'
  if (remaining < (due - created) * WARNING_RATIO) return 'warning'
  return 'ok'
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}
