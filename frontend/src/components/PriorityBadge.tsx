import type { TicketPriority } from '../api/types'
import { PRIORITY_LABEL } from '../api/labels'

export function PriorityBadge({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`badge priority-${priority.toLowerCase()}`} title={PRIORITY_LABEL[priority]}>
      {priority}
    </span>
  )
}
