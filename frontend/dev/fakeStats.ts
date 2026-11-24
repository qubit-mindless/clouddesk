import type { AtRiskTicket, Stats, Ticket, TicketPriority, TicketStatus, User } from '../src/api/types.ts'
import { CLOSED_STATUSES } from './fakeDemo.ts'

// GET /stats w udawanym API – te same definicje co w docs/api-kontrakty.md, żeby pulpit na makiecie
// pokazywał te same liczby, które policzy backend na tych samych danych.

const AT_RISK_RATIO = 0.25 // jak WARNING_RATIO w src/utils/sla.ts
const AT_RISK_TOP = 5
const STATUSES: TicketStatus[] = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
const PRIORITIES: TicketPriority[] = ['P1', 'P2', 'P3', 'P4']

// Dzień kalendarzowy w strefie Warszawy jako YYYY-MM-DD (en-CA formatuje datę właśnie tak).
const warsawDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' })
const dayOf = (ms: number) => warsawDay.format(ms)

const round1 = (value: number) => Math.round(value * 10) / 10

// `assistantAnswers`: id zgłoszenia → daty odpowiedzi asystenta (tylko istniejące zgłoszenia).
export function computeStats(
  tickets: Ticket[],
  users: User[],
  assistantAnswers: Map<number, string[]>,
  days: number,
  now = Date.now(),
): Stats {
  // Okno = `days` dni kalendarzowych w strefie Warszawy, ostatni to dziś. Ten sam zakres dla `daily`, `sla.resolved`,
  // `mttrHours` i `ai` – suma słupków zgadza się wtedy z kafelkami. Daty liczone kalendarzem, nie odejmowaniem 24 h,
  // bo zmiana czasu zdublowałaby albo zgubiła dzień.
  const [year, month, day] = dayOf(now).split('-').map(Number)
  const dates = Array.from({ length: days }, (_, i) => new Date(Date.UTC(year, month - 1, day - (days - 1 - i))).toISOString().slice(0, 10))
  const inWindow = (iso: string) => dayOf(Date.parse(iso)) >= dates[0]

  const open = tickets.filter((t) => !CLOSED_STATUSES.includes(t.status))
  const resolved = tickets.filter((t) => t.resolvedAt !== null && inWindow(t.resolvedAt))
  const onTime = resolved.filter((t) => Date.parse(t.resolvedAt as string) <= Date.parse(t.slaDueAt))

  const isBreached = (t: Ticket) => Date.parse(t.slaDueAt) <= now
  const isAtRisk = (t: Ticket) => {
    const due = Date.parse(t.slaDueAt)
    return due > now && due - now < (due - Date.parse(t.createdAt)) * AT_RISK_RATIO
  }

  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, tickets.filter((t) => t.status === s).length])) as Stats['byStatus']
  const byPriority = Object.fromEntries(PRIORITIES.map((p) => [p, open.filter((t) => t.priority === p).length])) as Stats['byPriority']

  const mttrHours = resolved.length
    ? round1(resolved.reduce((sum, t) => sum + Date.parse(t.resolvedAt as string) - Date.parse(t.createdAt), 0) / resolved.length / 3_600_000)
    : null

  const perTechnician = users
    .filter((u) => u.role === 'TECHNICIAN')
    .map((u) => ({
      login: u.login,
      fullName: u.fullName,
      open: open.filter((t) => t.assignee === u.login).length,
      resolved: resolved.filter((t) => t.assignee === u.login).length,
    }))
    .sort((a, b) => b.open - a.open || a.login.localeCompare(b.login))

  // Zgłoszenia liczone po dniu utworzenia i dniu rozwiązania.
  const daily = dates.map((date) => ({ date, created: 0, resolved: 0 }))
  const index = new Map(daily.map((d, i) => [d.date, i]))
  for (const t of tickets) {
    const created = index.get(dayOf(Date.parse(t.createdAt)))
    if (created !== undefined) daily[created].created++
    const done = t.resolvedAt ? index.get(dayOf(Date.parse(t.resolvedAt))) : undefined
    if (done !== undefined) daily[done].resolved++
  }

  const atRiskTop: AtRiskTicket[] = open
    .filter((t) => isBreached(t) || isAtRisk(t))
    .sort((a, b) => Date.parse(a.slaDueAt) - Date.parse(b.slaDueAt))
    .slice(0, AT_RISK_TOP)
    .map(({ id, title, priority, status, assignee, createdAt, slaDueAt }) => ({ id, title, priority, status, assignee, createdAt, slaDueAt }))

  const answers = [...assistantAnswers.values()].map((dates) => dates.filter(inWindow).length)
  return {
    days,
    generatedAt: new Date(now).toISOString(),
    byStatus,
    byPriority,
    sla: {
      open: open.length,
      breachedOpen: open.filter(isBreached).length,
      atRisk: open.filter(isAtRisk).length,
      resolved: resolved.length,
      resolvedOnTime: onTime.length,
      compliancePct: resolved.length ? round1((onTime.length / resolved.length) * 100) : null,
    },
    mttrHours,
    perTechnician,
    daily,
    ai: { answers: answers.reduce((sum, n) => sum + n, 0), tickets: answers.filter((n) => n > 0).length },
    atRiskTop,
  }
}
