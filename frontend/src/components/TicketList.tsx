import { Link, useLocation, useNavigate } from 'react-router'
import type { Ticket } from '../api/types'
import { useNow } from '../hooks/useNow'
import { timeAgo } from '../utils/time'
import { PriorityBadge } from './PriorityBadge'
import { SlaDue, SlaMiniBar } from './SlaDue'
import { StatusBadge } from './StatusBadge'

const OPEN = new Set(['NEW', 'ASSIGNED', 'IN_PROGRESS'])

interface Props {
  tickets: Ticket[]
  highlighted?: Set<number>
  flashSeq?: number
  // Technik/administrator: „Przejmij” przy otwartych, nieprzypisanych zgłoszeniach; `takingId` – zgłoszenie w trakcie zapisu.
  onTake?: (ticket: Ticket) => void
  takingId?: number | null
  // Trwa przejmowanie innego zgłoszenia – wszystkie przyciski „Przejmij” nieaktywne.
  takeBusy?: boolean
}

// `highlighted`: wiersze zmienione przy ostatnim odświeżeniu w tle – na chwilę się podświetlają (#141).
// `flashSeq`: numer podświetlenia – parzyste i nieparzyste mają osobne (identyczne) animacje, więc wiersz zmieniony
// ponownie, zanim zgasł, miga od początku (sama klasa, która zostaje na `tr`, animacji nie restartuje).
export function TicketList({ tickets, highlighted, flashSeq = 0, onTake, takingId = null, takeBusy = false }: Props) {
  const navigate = useNavigate()
  // Jeden timer dla wszystkich pigułek SLA w tabeli.
  const now = useNow(30_000)
  // Szczegóły dostają aktualne filtry, żeby przycisk powrotu wrócił do tego samego widoku.
  const { search } = useLocation()
  const state = { listSearch: search }

  if (tickets.length === 0) {
    return (
      <p className="empty" data-testid="ticket-list-empty">
        Brak zgłoszeń spełniających kryteria.
      </p>
    )
  }

  return (
    <div className="table-wrap">
      <table data-testid="ticket-list">
        <thead>
          <tr>
            <th>#</th>
            <th>Tytuł</th>
            <th>Priorytet</th>
            <th>Status</th>
            <th>Technik</th>
            <th>Termin SLA</th>
          </tr>
        </thead>
        <tbody>
          {tickets.map((t) => (
            <tr key={t.id} data-testid={`ticket-row-${t.id}`} className={`clickable ${highlighted?.has(t.id) ? `row-flash row-flash-${flashSeq % 2}` : ''}`} onClick={() => navigate(`/tickets/${t.id}`, { state })}>
              <td>{t.id}</td>
              <td>
                {/* Link zostaje dla klawiatury i czytników ekranu, kliknięcie w wiersz to skrót dla myszy. */}
                <Link to={`/tickets/${t.id}`} state={state} onClick={(e) => e.stopPropagation()}>
                  {t.title}
                </Link>
                <span className="row-sub" title={t.reporter}>
                  {t.reporterName} · {timeAgo(t.createdAt, now)}
                </span>
              </td>
              <td>
                <PriorityBadge priority={t.priority} />
              </td>
              <td>
                <StatusBadge status={t.status} />
              </td>
              <td>
                {t.assignee ? (
                  <span title={t.assignee}>{t.assigneeName ?? t.assignee}</span>
                ) : onTake && OPEN.has(t.status) ? (
                  <button
                    type="button"
                    className="take"
                    disabled={takeBusy}
                    onClick={(e) => {
                      e.stopPropagation()
                      onTake(t)
                    }}
                    data-testid={`ticket-take-${t.id}`}
                  >
                    {takingId === t.id ? 'Przejmowanie…' : 'Przejmij'}
                  </button>
                ) : (
                  '—'
                )}
              </td>
              <td>
                <SlaDue ticket={t} now={now} />
                <SlaMiniBar ticket={t} now={now} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
