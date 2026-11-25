import { useState } from 'react'
import { Link } from 'react-router'
import { getMeSummary } from '../api/activity'
import { getTickets, MAX_TICKETS } from '../api/tickets'
import type { Ticket, TicketStatus } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { StatusBadge } from '../components/StatusBadge'
import { useAuth } from '../hooks/useAuth'
import { useRequest } from '../hooks/useRequest'
import { formatDateTime } from '../utils/sla'
import { greeting, plural } from '../utils/time'
import { firstName } from '../utils/user'

// Widok zgłaszającego: karty zamiast tabeli – na każdej etap, kto się zgłoszeniem zajmuje i do kiedy odpowie.
const STEP: Record<TicketStatus, number> = { NEW: 1, ASSIGNED: 2, IN_PROGRESS: 3, RESOLVED: 4, CLOSED: 4 }
const STEP_NAMES = ['Nowe', 'Przypisane', 'W toku', 'Rozwiązane']
// Rozwiązanych pokazujemy kilka ostatnich – reszta po kliknięciu, żeby otwarte zostały na wierzchu.
const CLOSED_VISIBLE = 3

function isOpen(t: Ticket) {
  return t.status !== 'RESOLVED' && t.status !== 'CLOSED'
}

function who(t: Ticket, now = Date.now()): string {
  if (!isOpen(t)) return t.resolvedAt ? `Rozwiązane ${formatDateTime(t.resolvedAt)}.` : 'Rozwiązane.'
  // Po terminie nie piszemy „termin odpowiedzi: <data z przeszłości>”, tylko wprost, że minął.
  const due = Date.parse(t.slaDueAt) <= now ? `Termin minął ${formatDateTime(t.slaDueAt)}` : `Termin: ${formatDateTime(t.slaDueAt)}`
  if (!t.assignee) return `Czeka na technika. ${due.replace('Termin:', 'Termin odpowiedzi:')}.`
  return `Zajmuje się tym ${t.assigneeName ?? t.assignee}. ${due}.`
}

export function MyTicketsPage() {
  const { user } = useAuth()
  const { data: tickets, error, loading, reload } = useRequest('mine', async (signal) => (await getTickets({}, MAX_TICKETS, signal)).items)
  const { data: summary } = useRequest('me-summary', getMeSummary)
  const [showAllClosed, setShowAllClosed] = useState(false)

  const open = tickets?.filter(isOpen).sort((a, b) => a.slaDueAt.localeCompare(b.slaDueAt)) ?? []
  const closed = tickets?.filter((t) => !isOpen(t)).sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? '')) ?? []
  const name = firstName(user)
  const nextDue = summary?.mine.nextDueAt

  return (
    <>
      <div className="page-actions">
        <div className="hello">
          <h2>
            {greeting()}, {name}
          </h2>
          {tickets && (
            <p data-testid="my-summary">
              {open.length === 0 ? (
                'Nie masz otwartych zgłoszeń.'
              ) : (
                <>
                  Masz <b>{open.length} {plural(open.length, 'otwarte zgłoszenie', 'otwarte zgłoszenia', 'otwartych zgłoszeń')}</b>.
                  {nextDue && (
                    <>
                      {' '}
                      Najbliższa odpowiedź: <b>{formatDateTime(nextDue)}</b>.
                    </>
                  )}
                </>
              )}
            </p>
          )}
        </div>
        <Link to="/tickets/new" className="button primary" data-testid="ticket-new">
          + Zgłoś problem
        </Link>
      </div>

      {loading && <Loading label="Ładowanie zgłoszeń…" />}
      {error !== undefined && <ErrorState error={error} onRetry={reload} />}

      {tickets && (
        <div className="my-grid" data-testid="my-tickets">
          {open.map((t) => (
            <TicketCard key={t.id} ticket={t} />
          ))}
          <div className="my-cta">
            <h3>Masz problem z komputerem?</h3>
            <p>Opisz go – asystent AI od razu podpowie, co sprawdzić, a technik dostanie całą rozmowę.</p>
            <Link to="/tickets/new" className="button">
              Zgłoś problem →
            </Link>
          </div>
        </div>
      )}
      {closed.length > 0 && (
        <section className="my-closed" aria-labelledby="my-closed-heading">
          <h3 id="my-closed-heading">Rozwiązane</h3>
          <div className="my-grid">
            {(showAllClosed ? closed : closed.slice(0, CLOSED_VISIBLE)).map((t) => (
              <TicketCard key={t.id} ticket={t} />
            ))}
          </div>
          {closed.length > CLOSED_VISIBLE && (
            <button type="button" onClick={() => setShowAllClosed((v) => !v)} aria-expanded={showAllClosed} data-testid="my-closed-toggle">
              {showAllClosed ? 'Pokaż mniej' : `Pokaż wszystkie rozwiązane (${closed.length})`}
            </button>
          )}
        </section>
      )}
    </>
  )
}

function TicketCard({ ticket: t }: { ticket: Ticket }) {
  return (
    <Link to={`/tickets/${t.id}`} className="my-card" data-testid="my-ticket">
      <span className="my-card-top">
        <span className="muted">#{t.id}</span>
        <StatusBadge status={t.status} />
      </span>
      <strong className="my-card-title" title={t.title}>
        {t.title}
      </strong>
      <span className="steps" role="img" aria-label={`Etap ${STEP[t.status]} z 4: ${STEP_NAMES[STEP[t.status] - 1]}`}>
        {STEP_NAMES.map((name, i) => (
          <i key={name} className={i < STEP[t.status] ? 'on' : undefined} />
        ))}
      </span>
      <span className="my-card-info">{who(t)}</span>
    </Link>
  )
}
