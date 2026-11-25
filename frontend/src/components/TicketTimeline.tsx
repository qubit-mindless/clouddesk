import { ApiError, errorMessage } from '../api/client'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'
import { getTicketHistory } from '../api/tickets'
import type { Ticket, TicketHistoryEntry, TicketPriority, TicketStatus } from '../api/types'
import { useNow } from '../hooks/useNow'
import { useRequest } from '../hooks/useRequest'
import { formatAgo, formatDateTime } from '../utils/sla'

// Oś historii zgłoszenia (#139): utworzenie (z samego zgłoszenia) i każda zmiana z ticket_history, od najstarszej.
// Edycja odbywa się na osobnej stronie, więc po zapisie (PATCH) szczegóły i oś ładują się od nowa.
// Wpis o utworzeniu jest zawsze – nawet gdy historii nie da się pobrać.
// Zmiana jest opisana tekstem („Status: Nowe → W toku”), a nie samym kolorem czy ikoną. Opis bezosobowy,
// z autorem w metadanych – bez zgadywania rodzaju gramatycznego („zmienił/zmieniła”).

const ICON: Partial<Record<string, string>> = {
  status: '⟳',
  priority: '⚑',
  assignee: '@',
  title: '✎',
  description: '✎',
}

// „Imię Nazwisko (login)”, a gdy nazwiska brak albo jest równe loginowi – sam login.
const person = (name: string | null | undefined, login: string) => (name && name !== login ? `${name} (${login})` : login)

const statusLabel = (v: string | null) => (v ? (STATUS_LABEL[v as TicketStatus] ?? v) : '—')
const priorityLabel = (v: string | null) => (v ? (PRIORITY_LABEL[v as TicketPriority] ?? v) : '—')

function describeChange({ field, oldValue, newValue }: TicketHistoryEntry): string {
  switch (field) {
    case 'status':
      return `Status: ${statusLabel(oldValue)} → ${statusLabel(newValue)}`
    case 'priority':
      return `Priorytet: ${priorityLabel(oldValue)} → ${priorityLabel(newValue)}`
    case 'assignee':
      if (oldValue === null) return `Przypisano technika: ${newValue}`
      if (newValue === null) return `Usunięto przypisanie technika ${oldValue}`
      return `Technik: ${oldValue} → ${newValue}`
    case 'title':
      return `Tytuł: „${oldValue ?? ''}” → „${newValue ?? ''}”`
    case 'description':
      return 'Zmieniono opis'
    default:
      // Pole, którego ten front jeszcze nie zna – lepiej ogólny opis niż pusty wpis.
      return `Zmieniono pole ${String(field)}`
  }
}

export function TicketTimeline({ ticket }: { ticket: Ticket }) {
  const now = useNow(60_000)
  const { data, error, loading, reload } = useRequest(String(ticket.id), (signal) => getTicketHistory(ticket.id, signal))
  const gone = error instanceof ApiError && error.status === 404

  return (
    <section className="history" aria-labelledby="history-title" data-testid="ticket-history">
      <h3 id="history-title">Historia zmian</h3>
      <ol className="timeline" aria-busy={loading}>
        <TimelineItem
          icon="+"
          text="Utworzono zgłoszenie"
          who={person(ticket.reporterName, ticket.reporter)}
          at={ticket.createdAt}
          now={now}
          testId="history-created"
        />
        {data?.items.map((entry) => (
          <TimelineItem
            key={entry.id}
            icon={ICON[entry.field] ?? '•'}
            text={describeChange(entry)}
            who={person(entry.authorName, entry.author)}
            at={entry.changedAt}
            now={now}
            testId={`history-item-${entry.id}`}
            field={entry.field}
          />
        ))}
      </ol>
      {loading && !data && <p className="history-hint">Ładowanie historii…</p>}
      {/* Komunikat w regionie statusu, przycisk obok – czytnik ogłasza tylko treść. */}
      {error !== undefined && (
        <div className="history-error">
          <p className="history-hint" role="status" data-testid="history-error">
            {/* 404 przy wczytanym zgłoszeniu = ktoś je w międzyczasie usunął albo straciliśmy do niego dostęp –
                ponawianie nic nie da, więc bez przycisku. */}
            {gone ? 'Zgłoszenie nie jest już dostępne – mogło zostać usunięte.' : `Nie udało się pobrać historii zmian. ${errorMessage(error)}`}
          </p>
          {!gone && (
            <button type="button" className="link-button" onClick={reload} data-testid="history-retry">
              Spróbuj ponownie
            </button>
          )}
        </div>
      )}
      {data && data.items.length === 0 && <p className="history-hint">Bez zmian od utworzenia.</p>}
    </section>
  )
}

interface ItemProps {
  icon: string
  text: string
  who: string
  at: string
  now: number
  testId: string
  field?: TicketHistoryEntry['field']
}

function TimelineItem({ icon, text, who, at, now, testId, field }: ItemProps) {
  return (
    <li className={`timeline-item ${field ? `timeline-${field}` : 'timeline-created'}`} data-testid={testId}>
      <span className="timeline-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <p className="timeline-text">{text}</p>
        <p className="timeline-meta">
          {who} · <time dateTime={at} title={formatDateTime(at)}>{formatAgo(at, now)}</time>
        </p>
      </div>
    </li>
  )
}
