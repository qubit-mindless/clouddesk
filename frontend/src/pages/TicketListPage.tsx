import { Link, useSearchParams } from 'react-router'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'
import { getMeSummary } from '../api/activity'
import { getTickets } from '../api/tickets'
import type { TicketPriority, TicketStatus } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LiveStatus } from '../components/LiveStatus'
import { Loading } from '../components/Loading'
import { ActivityFeed } from '../components/overview/ActivityFeed'
import { AiTodayCard, Hello, SummaryStrip } from '../components/overview/SummaryStrip'
import { TicketFilters, type TicketFilterValues } from '../components/TicketFilters'
import { TicketList } from '../components/TicketList'
import { useAuth } from '../hooks/useAuth'
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

  // Powitanie, liczniki i karta AI (pakiet z makiety) – jedno żądanie /me/summary, odświeżane razem z listą.
  const { user } = useAuth()
  const { data: summary } = useRequest('me-summary', getMeSummary, { keepData: true, intervalMs: REFRESH_MS })

  const query = filters.query.trim().toLowerCase()
  const tickets = data?.filter((t) => !query || t.title.toLowerCase().includes(query))

  return (
    <>
      <div className="page-actions">
        <Hello name={user?.fullName.split(' ')[0] ?? ''} summary={summary} />
        <Link to="/tickets/new" className="button primary" data-testid="ticket-new">
          + Nowe zgłoszenie
        </Link>
      </div>
      {summary && <SummaryStrip summary={summary} />}
      <div className="list-layout">
        <div className="list-main">
          <TicketFilters values={filters} onChange={handleChange} />
          <div className="list-meta">
            <LiveStatus updatedAt={updatedAt} failed={failed} />
          </div>
          {/* Zgłoszenia, które pojawiły się na liście, ogłaszamy raz, po odświeżeniu – bez tykających liczb. */}
          <p className="visually-hidden" aria-live="polite" data-testid="list-announcer">
            {flash?.added ? `Pojawiły się na liście: ${flash.added}` : ''}
          </p>
          {loading && !data && <Loading label="Ładowanie zgłoszeń…" />}
          {error !== undefined && !data && <ErrorState error={error} onRetry={reload} />}
          {tickets && <TicketList tickets={tickets} highlighted={flash?.ids} flashSeq={flash?.seq} />}
        </div>
        <aside className="list-side" aria-label="Aktywność i asystent AI">
          <ActivityFeed />
          {summary && <AiTodayCard summary={summary} />}
        </aside>
      </div>
    </>
  )
}
