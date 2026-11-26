import type { Ticket } from '../api/types'
import { formatRemaining, getSlaState } from '../utils/sla'
import { formatDateTime } from '../utils/time'

// Pigułka SLA z odliczaniem (#141): „2 h 14 min”, blisko terminu na bursztynowo, po terminie na czerwono z minusem.
// Rozwiązane i zamknięte mają zamrożony wynik ✓/✗ (czy zdążyliśmy przed terminem). Stan jest też w tekście
// (ukryty dopisek dla czytnika i ikona), nie tylko w kolorze; dokładna data terminu w `title`.
// `now` przychodzi z jednego timera strony (useNow) – nie ma licznika na każdy wiersz.

const PREFIX = {
  ok: 'zostało',
  warning: 'blisko terminu, zostało',
  breached: 'po terminie',
} as const

const ICON = { ok: '◷', warning: '⚠', breached: '✗' } as const

export function SlaDue({ ticket, now }: { ticket: Ticket; now: number }) {
  const state = getSlaState(ticket, new Date(now))
  const due = Date.parse(ticket.slaDueAt)
  const title = `Termin SLA: ${formatDateTime(ticket.slaDueAt)}`

  if (state === 'done') {
    // Bez daty rozwiązania (stare dane) nie wiemy, czy zdążyliśmy – neutralne „zakończone” zamiast zgadywania.
    if (ticket.resolvedAt === null) {
      return (
        <span className="sla-pill sla-done" data-sla="done" title={title} data-testid="sla-pill">
          zakończone
        </span>
      )
    }
    const onTime = Date.parse(ticket.resolvedAt) <= due
    return (
      <span className={`sla-pill sla-done ${onTime ? 'sla-met' : 'sla-missed'}`} data-sla="done" title={title} data-testid="sla-pill">
        <span aria-hidden="true">{onTime ? '✓' : '✗'}</span> {onTime ? 'w terminie' : 'po terminie'}
      </span>
    )
  }

  const remaining = due - now
  return (
    <span className={`sla-pill sla-${state}`} data-sla={state} title={title} data-testid="sla-pill">
      <span aria-hidden="true">{ICON[state]}</span> <span className="visually-hidden">{PREFIX[state]} </span>
      {formatRemaining(remaining)}
    </span>
  )
}

// Pasek w szczegółach: jaka część czasu SLA już upłynęła (dla zakończonych – do momentu rozwiązania).
export function SlaProgress({ ticket, now }: { ticket: Ticket; now: number }) {
  const state = getSlaState(ticket, new Date(now))
  // Zakończone bez daty rozwiązania (stare dane): nie ma czym zamrozić paska, więc go nie pokazujemy.
  if (state === 'done' && ticket.resolvedAt === null) return null
  const created = Date.parse(ticket.createdAt)
  const due = Date.parse(ticket.slaDueAt)
  const end = ticket.resolvedAt ? Date.parse(ticket.resolvedAt) : now
  // „Po terminie” rozstrzyga porównanie niezaokrąglonych czasów – zaokrąglony procent mógłby pokazać 100% przy już minionym terminie.
  const over = end > due
  const pct = due > created ? Math.max(0, Math.round(((end - created) / (due - created)) * 100)) : 100

  return (
    <div className="sla-progress" data-testid="sla-progress">
      <span className="sla-progress-track" aria-hidden="true">
        <span className={`sla-progress-fill sla-${state}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </span>
      <small>
        {over
          ? ticket.resolvedAt
            ? 'rozwiązane po upływie czasu SLA'
            : 'czas SLA minął'
          : `${ticket.resolvedAt ? 'wykorzystano' : 'upłynęło'} ${pct}% czasu SLA`}
      </small>
    </div>
  )
}

// Cienki pasek pod pigułką w tabeli: ile czasu SLA upłynęło. Tylko dla oka – stan i czas mówi już pigułka.
export function SlaMiniBar({ ticket, now }: { ticket: Ticket; now: number }) {
  const state = getSlaState(ticket, new Date(now))
  if (state === 'done') return null
  const created = Date.parse(ticket.createdAt)
  const due = Date.parse(ticket.slaDueAt)
  const pct = due > created ? Math.min(100, Math.max(0, ((now - created) / (due - created)) * 100)) : 100
  return (
    <span className="sla-mini" aria-hidden="true">
      <span className={`sla-mini-fill sla-${state}`} style={{ width: `${pct}%` }} />
    </span>
  )
}
