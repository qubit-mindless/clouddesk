import { Link, useSearchParams } from 'react-router'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'
import { getTickets } from '../api/tickets'
import type { TicketPriority, TicketStatus } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { TicketFilters, type TicketFilterValues } from '../components/TicketFilters'
import { TicketList } from '../components/TicketList'
import { useRequest } from '../hooks/useRequest'

// Nieznana wartość w adresie (np. ?status=FOO) jest pomijana, zamiast dawać pustą listę.
function pick<T extends string>(value: string | null, allowed: Record<T, string>): T | '' {
  return value && value in allowed ? (value as T) : ''
}

export function TicketListPage() {
  // Filtry siedzą w adresie (?status=&priority=&q=), więc powrót ze szczegółów ich nie gubi.
  const [params, setParams] = useSearchParams()
  const filters: TicketFilterValues = {
    status: pick<TicketStatus>(params.get('status'), STATUS_LABEL),
    priority: pick<TicketPriority>(params.get('priority'), PRIORITY_LABEL),
    query: params.get('q') ?? '',
  }

  const handleChange = (next: TicketFilterValues) => {
    const entries = Object.entries({ status: next.status, priority: next.priority, q: next.query })
    setParams(entries.filter(([, value]) => value !== ''), { replace: true })
  }

  // Status i priorytet filtruje API, a wyszukiwanie po tytule działa od razu w przeglądarce.
  const { status, priority } = filters
  const { data, error, loading, reload } = useRequest(`${status}|${priority}`, (signal) =>
    getTickets({ status: status || undefined, priority: priority || undefined }, signal),
  )

  const query = filters.query.trim().toLowerCase()
  const tickets = data?.filter((t) => !query || t.title.toLowerCase().includes(query))

  return (
    <>
      <div className="page-actions">
        <Link to="/tickets/new" className="button primary" data-testid="ticket-new">
          + Nowe zgłoszenie
        </Link>
      </div>
      <TicketFilters values={filters} onChange={handleChange} />
      {loading && <Loading label="Ładowanie zgłoszeń…" />}
      {error !== undefined && <ErrorState error={error} onRetry={reload} />}
      {tickets && <TicketList tickets={tickets} />}
    </>
  )
}
