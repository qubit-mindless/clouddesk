import type { Ticket } from '../api/types'
import { formatDateTime, getSlaState } from '../utils/sla'

const SLA_HINT = {
  done: '',
  ok: '',
  warning: 'blisko terminu',
  breached: 'przekroczony',
} as const

export function SlaDue({ ticket }: { ticket: Ticket }) {
  const state = getSlaState(ticket)
  return (
    <span className={`sla sla-${state}`} data-sla={state}>
      {formatDateTime(ticket.slaDueAt)}
      {SLA_HINT[state] && <small> ({SLA_HINT[state]})</small>}
    </span>
  )
}
