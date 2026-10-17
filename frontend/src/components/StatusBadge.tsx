import type { TicketStatus } from '../api/types'
import { STATUS_LABEL } from '../api/labels'

export function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`badge status-${status.toLowerCase()}`}>{STATUS_LABEL[status]}</span>
}
