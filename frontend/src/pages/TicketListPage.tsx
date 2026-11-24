import { useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'
import { getMeSummary } from '../api/activity'
import { errorMessage } from '../api/client'
import { getTickets, updateTicket } from '../api/tickets'
import type { Ticket, TicketPriority, TicketStatus } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { LiveStatus } from '../components/LiveStatus'
import { Loading } from '../components/Loading'
import { ActivityFeed } from '../components/overview/ActivityFeed'
import { AiTodayCard, Hello, SummaryStrip } from '../components/overview/SummaryStrip'
import { TicketFilters, type TicketFilterValues } from '../components/TicketFilters'
import { TicketList } from '../components/TicketList'
import { canManageTicket } from '../auth/permissions'
import { useAuth } from '../hooks/useAuth'
import { useChangedRows } from '../hooks/useChangedRows'
import { useRequest } from '../hooks/useRequest'
import { useToast } from '../hooks/useToast'

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
  const { data: summary, reload: reloadSummary } = useRequest('me-summary', getMeSummary, {
    keepData: true,
    intervalMs: REFRESH_MS,
    pollWithoutData: true,
  })

  // „Przejmij”: przypisanie do siebie (nowe → przypisane) prosto z listy; potem świeża lista i liczniki.
  const toast = useToast()
  const [takingId, setTakingId] = useState<number | null>(null)
  const take = async (ticket: Ticket) => {
    if (!user || takingId !== null) return
    setTakingId(ticket.id)
    try {
      await updateTicket(ticket.id, { assignee: user.login, ...(ticket.status === 'NEW' ? { status: 'ASSIGNED' as const } : {}) })
      toast(`Przejęto zgłoszenie #${ticket.id}.`)
      reload()
      reloadSummary()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setTakingId(null)
    }
  }

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
          {tickets && (
            <TicketList
              tickets={tickets}
              highlighted={flash?.ids}
              flashSeq={flash?.seq}
              onTake={canManageTicket(user) ? take : undefined}
              takingId={takingId}
            />
          )}
        </div>
        <aside className="list-side" aria-label="Aktywność i asystent AI">
          <ActivityFeed />
          {summary && <AiTodayCard summary={summary} />}
        </aside>
      </div>
    </>
  )
}
