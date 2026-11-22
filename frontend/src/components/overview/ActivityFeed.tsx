import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getActivity } from '../../api/activity'
import { PRIORITY_LABEL, STATUS_LABEL } from '../../api/labels'
import type { ActivityItem, TicketPriority, TicketStatus } from '../../api/types'
import { timeAgo } from '../../utils/time'

// „Aktywność na żywo”: ostatnie zdarzenia w zgłoszeniach. Odświeża się co 30 s, tylko przy widocznej karcie.
const REFRESH_MS = 30_000
const LIMIT = 12

function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function describe(item: ActivityItem): string {
  const status = (value: string | null) => (value ? (STATUS_LABEL[value as TicketStatus] ?? value) : '—')
  switch (item.kind) {
    case 'created':
      return `zgłasza: ${PRIORITY_LABEL[item.newValue as TicketPriority] ?? item.newValue}`
    case 'ai':
      return 'odpowiedź asystenta'
  }
  switch (item.field) {
    case 'status':
      return `status: ${status(item.oldValue)} → ${status(item.newValue)}`
    case 'assignee':
      return item.newValue ? `przypisanie: ${item.newValue}` : 'zwolnienie zgłoszenia'
    case 'priority':
      return `priorytet: ${item.oldValue} → ${item.newValue}`
    case 'resolution':
      return 'zamknięte po pomocy asystenta ✓'
    default:
      return 'zmiana treści'
  }
}

export function ActivityFeed() {
  const [items, setItems] = useState<ActivityItem[]>()
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let controller = new AbortController()
    const load = () => {
      controller.abort()
      const current = new AbortController()
      controller = current
      getActivity(LIMIT, current.signal).then(
        (data) => {
          setItems(data.items)
          setFailed(false)
        },
        () => {
          if (!current.signal.aborted) setFailed(true)
        },
      )
    }
    load()
    const timer = window.setInterval(() => {
      if (!document.hidden) load()
    }, REFRESH_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [])

  return (
    <section className="side-card feed" aria-labelledby="feed-heading" data-testid="activity-feed">
      <h3 id="feed-heading">Aktywność na żywo</h3>
      {failed && !items && <p className="muted">Nie udało się wczytać aktywności.</p>}
      {items && items.length === 0 && <p className="muted">Na razie cisza.</p>}
      {items && (
        <ol>
          {items.map((item) => (
            <li key={item.id}>
              <span className={`avatar${item.kind === 'ai' ? ' avatar-ai' : ''}`} aria-hidden="true">
                {item.kind === 'ai' ? '✦' : initials(item.actorName)}
              </span>
              <div>
                <b>{item.actorName}</b> · {describe(item)}
                <Link to={`/tickets/${item.ticketId}`} className="feed-ticket">
                  #{item.ticketId} {item.ticketTitle}
                </Link>
                <time dateTime={item.at}>{timeAgo(item.at)}</time>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
