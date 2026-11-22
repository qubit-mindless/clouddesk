import type { ActivityItem, AppNotification, MeSummary, Ticket, User } from '../src/api/types.ts'
import { CLOSED_STATUSES, type FakeHistoryEntry } from './fakeDemo.ts'

// Udawane odpowiedzi pakietu z makiety (aktywność, powiadomienia, /me/summary) – definicje jak w docs/api-kontrakty.md.

interface Message {
  id: number
  role: 'user' | 'assistant'
  createdAt: string
}

export interface FakeStore {
  tickets: Ticket[]
  history: FakeHistoryEntry[]
  conversations: Map<number, Message[]>
  users: User[]
}

const WARNING_RATIO = 0.25
const NOTIFICATION_DAYS = 7
const warsawDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' })
const dayOf = (ms: number) => warsawDay.format(ms)
const nameOf = (users: User[], login: string | null) => users.find((u) => u.login === login)?.fullName ?? login ?? ''

function visible(store: FakeStore, actor: User): Ticket[] {
  return actor.role === 'REPORTER' ? store.tickets.filter((t) => t.reporter === actor.login) : store.tickets
}

function slaOf(t: Ticket, now: number): 'breached' | 'atRisk' | 'ok' {
  const due = Date.parse(t.slaDueAt)
  if (due <= now) return 'breached'
  return due - now < WARNING_RATIO * (due - Date.parse(t.createdAt)) ? 'atRisk' : 'ok'
}

export function computeActivity(store: FakeStore, actor: User, limit: number): ActivityItem[] {
  const own = visible(store, actor)
  const byId = new Map(own.map((t) => [t.id, t]))
  const items: ActivityItem[] = []
  for (const h of store.history) {
    const t = byId.get(h.ticketId)
    if (!t) continue
    items.push({ id: `h-${h.id}`, kind: 'change', ticketId: t.id, ticketTitle: t.title, actor: h.author, actorName: nameOf(store.users, h.author),
      field: h.field, oldValue: h.oldValue, newValue: h.newValue, at: h.changedAt })
  }
  for (const t of own) {
    items.push({ id: `t-${t.id}`, kind: 'created', ticketId: t.id, ticketTitle: t.title, actor: t.reporter, actorName: nameOf(store.users, t.reporter),
      field: 'priority', oldValue: null, newValue: t.priority, at: t.createdAt })
    for (const m of store.conversations.get(t.id) ?? []) {
      if (m.role !== 'assistant') continue
      items.push({ id: `a-${m.id}`, kind: 'ai', ticketId: t.id, ticketTitle: t.title, actor: null, actorName: 'Asystent AI',
        field: null, oldValue: null, newValue: null, at: m.createdAt })
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id)).slice(0, limit)
}

export function computeNotifications(store: FakeStore, actor: User, seenAt: number | undefined): { unread: number; items: AppNotification[] } {
  const now = Date.now()
  const since = now - NOTIFICATION_DAYS * 86_400_000
  const staff = actor.role !== 'REPORTER'
  const byId = new Map(store.tickets.map((t) => [t.id, t]))
  const out: Omit<AppNotification, 'unread'>[] = []
  for (const h of store.history) {
    const t = byId.get(h.ticketId)
    if (!t || h.author === actor.login) continue
    const base = { ticketId: t.id, ticketTitle: t.title, actorName: nameOf(store.users, h.author), at: h.changedAt }
    if (staff && h.field === 'assignee' && h.newValue === actor.login) out.push({ id: `n-h-${h.id}`, kind: 'assigned', value: h.newValue, ...base })
    if (!staff && t.reporter === actor.login && h.field === 'status') out.push({ id: `n-h-${h.id}`, kind: 'status', value: h.newValue, ...base })
    if (!staff && t.reporter === actor.login && h.field === 'assignee' && h.newValue) out.push({ id: `n-h-${h.id}`, kind: 'taken', value: h.newValue, ...base })
  }
  if (staff) {
    for (const t of store.tickets) {
      if (t.priority === 'P1' && t.reporter !== actor.login) {
        out.push({ id: `n-p1-${t.id}`, kind: 'new_p1', ticketId: t.id, ticketTitle: t.title, actorName: nameOf(store.users, t.reporter), value: 'P1', at: t.createdAt })
      }
      const mine = t.assignee === actor.login || t.assignee === null
      if (!CLOSED_STATUSES.includes(t.status) && mine && Date.parse(t.slaDueAt) <= now) {
        out.push({ id: `n-sla-${t.id}`, kind: 'sla_breached', ticketId: t.id, ticketTitle: t.title, actorName: null, value: t.priority, at: t.slaDueAt })
      }
    }
  }
  const items = out
    .filter((n) => Date.parse(n.at) >= since && Date.parse(n.at) <= now)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 20)
    .map((n) => ({ ...n, unread: seenAt === undefined || Date.parse(n.at) > seenAt }))
  return { unread: items.filter((n) => n.unread).length, items }
}

export function computeMeSummary(store: FakeStore, actor: User): MeSummary {
  const now = Date.now()
  const today = dayOf(now)
  const staff = actor.role !== 'REPORTER'
  const open = store.tickets.filter((t) => !CLOSED_STATUSES.includes(t.status))
  const mineOpen = open.filter((t) => (staff ? t.assignee === actor.login : t.reporter === actor.login))
  const states = (list: Ticket[]) => list.map((t) => slaOf(t, now))
  const count = (list: Ticket[], s: string) => states(list).filter((x) => x === s).length
  const nextDue = mineOpen.map((t) => t.slaDueAt).filter((d) => Date.parse(d) > now).sort()[0] ?? null
  const mine = { open: mineOpen.length, breached: count(mineOpen, 'breached'), atRisk: count(mineOpen, 'atRisk'), nextDueAt: nextDue }
  if (!staff) return { mine, team: null, aiToday: null }

  const last7Days = Array.from({ length: 7 }, (_, i) => {
    const date = dayOf(now - (6 - i) * 86_400_000)
    return {
      date,
      created: store.tickets.filter((t) => dayOf(Date.parse(t.createdAt)) === date).length,
      resolved: store.tickets.filter((t) => t.resolvedAt && dayOf(Date.parse(t.resolvedAt)) === date).length,
    }
  })
  const answeredToday = new Map<number, number>()
  for (const [ticketId, msgs] of store.conversations) {
    const n = msgs.filter((m) => m.role === 'assistant' && dayOf(Date.parse(m.createdAt)) === today).length
    if (n && store.tickets.some((t) => t.id === ticketId)) answeredToday.set(ticketId, n)
  }
  const selfResolved = new Set(
    store.history.filter((h) => h.field === 'resolution' && h.newValue === 'SELF_AI' && dayOf(Date.parse(h.changedAt)) === today).map((h) => h.ticketId),
  )
  const resolvedByReporter = [...answeredToday.keys()].filter((id) => selfResolved.has(id)).length
  return {
    mine,
    team: {
      breached: count(open, 'breached'),
      atRisk: count(open, 'atRisk'),
      createdToday: last7Days[6].created,
      resolvedToday: last7Days[6].resolved,
      last7Days,
    },
    aiToday: {
      conversations: answeredToday.size,
      resolvedByReporter,
      handedOver: answeredToday.size - resolvedByReporter,
      answers: [...answeredToday.values()].reduce((a, b) => a + b, 0),
    },
  }
}
