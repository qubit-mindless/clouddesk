import { Link, useSearchParams } from 'react-router'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'
import { getTickets } from '../api/tickets'
import type { TicketPriority, TicketStatus } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LiveStatus } from '../components/LiveStatus'
import { Loading } from '../components/Loading'
import { TicketFilters, type TicketFilterValues } from '../components/TicketFilters'
import { TicketList } from '../components/TicketList'
import { useChangedRows } from '../hooks/useChangedRows'
import { useRequest } from '../hooks/useRequest'

// Nieznana wartość w adresie (np. ?status=FOO) jest pomijana, zamiast dawać pustą listę.
function pick<T extends string>(value: string | null, allowed: Record<T, string>): T | '' {
  return value && value in allowed ? (value as T) : ''
}

const REFRESH_MS = 20_000

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
  // Lista odświeża się sama co REFRESH_MS (#141); w tle zostają poprzednie dane, więc tabela nie miga.
  const { status, priority } = filters
  const key = `${status}|${priority}`
  const { data, error, loading, dataKey, updatedAt, failed, reload } = useRequest(
    key,
    (signal) => getTickets({ status: status || undefined, priority: priority || undefined }, signal),
    { keepData: true, intervalMs: REFRESH_MS },
  )
  const flash = useChangedRows(data, dataKey, !loading && error === undefined)

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
      <div className="list-meta">
        <LiveStatus updatedAt={updatedAt} failed={failed} />
      </div>
      {/* Nowe zgłoszenia ogłaszamy raz, po odświeżeniu – bez tykających liczb. */}
      <p className="visually-hidden" aria-live="polite" data-testid="list-announcer">
        {flash?.added ? `Nowe zgłoszenia na liście: ${flash.added}` : ''}
      </p>
      {loading && !data && <Loading label="Ładowanie zgłoszeń…" />}
      {error !== undefined && !data && <ErrorState error={error} onRetry={reload} />}
      {tickets && <TicketList tickets={tickets} highlighted={flash?.ids} />}
    </>
  )
}
