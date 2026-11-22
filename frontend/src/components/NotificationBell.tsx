import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getNotifications, markNotificationsRead } from '../api/activity'
import { STATUS_LABEL } from '../api/labels'
import type { AppNotification, Notifications, TicketStatus } from '../api/types'
import { timeAgo } from '../utils/time'

// Co minutę, i tylko przy widocznej karcie – każde żądanie budzi backend skalujący się do zera.
const REFRESH_MS = 60_000

function describe(n: AppNotification): string {
  switch (n.kind) {
    case 'assigned':
      return `Przypisano Ci zgłoszenie #${n.ticketId}${n.actorName ? ` (${n.actorName})` : ''}`
    case 'new_p1':
      return `Nowe zgłoszenie P1 #${n.ticketId}`
    case 'sla_breached':
      return `#${n.ticketId} przekroczyło termin SLA`
    case 'status':
      return `#${n.ticketId}: status zmieniony na „${STATUS_LABEL[n.value as TicketStatus] ?? n.value}”`
    case 'taken':
      return `Technik zajął się Twoim zgłoszeniem #${n.ticketId}`
  }
}

const ICON: Record<AppNotification['kind'], string> = { assigned: '👤', new_p1: 'P1', sla_breached: '!', status: '→', taken: '👤' }

export function NotificationBell() {
  const [data, setData] = useState<Notifications>()
  const [open, setOpen] = useState(false)
  const [ring, setRing] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  const lastUnread = useRef(0)

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const next = await getNotifications(signal)
      // Dzwonek kołysze się tylko wtedy, gdy przybyło nieprzeczytanych (nie przy pierwszym wczytaniu).
      if (next.unread > lastUnread.current && lastUnread.current > 0) setRing(true)
      lastUnread.current = next.unread
      setData(next)
    } catch {
      // Powiadomienia są dodatkiem – błąd sieci nie przeszkadza w pracy, spróbujemy przy następnym odświeżeniu.
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const timer = window.setInterval(() => {
      if (!document.hidden) void load()
    }, REFRESH_MS)
    return () => {
      controller.abort()
      window.clearInterval(timer)
    }
  }, [load])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        button.current?.focus()
      }
    }
    document.addEventListener('click', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    setOpen((v) => !v)
    if (!open) void load()
  }

  const markRead = async () => {
    try {
      await markNotificationsRead(data?.items[0]?.at)
      lastUnread.current = 0
      setData((d) => d && { unread: 0, items: d.items.map((n) => ({ ...n, unread: false })) })
    } catch {
      // Zostawiamy stan bez zmian – licznik zgaśnie przy następnej udanej próbie.
    }
  }

  const unread = data?.unread ?? 0
  return (
    <div className="bell-wrap" ref={wrap}>
      <button
        ref={button}
        type="button"
        className={`bell${ring ? ' ring' : ''}`}
        onClick={toggle}
        onAnimationEnd={() => setRing(false)}
        aria-expanded={open}
        aria-controls="notifications"
        aria-label={unread ? `Powiadomienia, nieprzeczytane: ${unread}` : 'Powiadomienia'}
        data-testid="notifications-bell"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
          <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="bell-count" data-testid="notifications-count">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="notifications" id="notifications" data-testid="notifications">
          <header>
            <h3>Powiadomienia</h3>
            {unread > 0 && (
              <button type="button" onClick={() => void markRead()} data-testid="notifications-read">
                Oznacz jako przeczytane
              </button>
            )}
          </header>
          {data && data.items.length === 0 && <p className="notifications-empty">Nic nowego z ostatnich 7 dni.</p>}
          <ul>
            {data?.items.map((n) => (
              <li key={n.id} className={n.unread ? 'unread' : undefined}>
                <span className={`notification-icon notification-${n.kind}`} aria-hidden="true">
                  {ICON[n.kind]}
                </span>
                <Link to={`/tickets/${n.ticketId}`} onClick={() => setOpen(false)}>
                  {describe(n)}
                  <span className="notification-title">{n.ticketTitle}</span>
                  <time dateTime={n.at}>{timeAgo(n.at)}</time>
                </Link>
                {n.unread && <span className="visually-hidden">(nowe)</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
