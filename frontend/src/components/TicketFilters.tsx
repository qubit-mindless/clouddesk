import type { TicketPriority, TicketStatus } from '../api/types'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'

// Jak `q` w API (GET /tickets): dłuższe wyszukiwanie kończyłoby się błędem 422 zamiast listą.
export const SEARCH_MAX = 200

export interface TicketFilterValues {
  status: TicketStatus | ''
  priority: TicketPriority | ''
  query: string
}

interface Props {
  values: TicketFilterValues
  onChange: (values: TicketFilterValues) => void
}

export function TicketFilters({ values, onChange }: Props) {
  return (
    <div className="filters">
      <label>
        Status
        <select
          data-testid="ticket-filter-status"
          value={values.status}
          onChange={(e) => onChange({ ...values, status: e.target.value as TicketFilterValues['status'] })}
        >
          <option value="">Wszystkie</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label>
        Priorytet
        <select
          data-testid="ticket-filter-priority"
          value={values.priority}
          onChange={(e) => onChange({ ...values, priority: e.target.value as TicketFilterValues['priority'] })}
        >
          <option value="">Wszystkie</option>
          {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="filters-search">
        Szukaj
        <input
          type="search"
          data-testid="ticket-search"
          placeholder="Tytuł zgłoszenia"
          maxLength={SEARCH_MAX}
          value={values.query}
          onChange={(e) => onChange({ ...values, query: e.target.value })}
        />
      </label>
    </div>
  )
}
