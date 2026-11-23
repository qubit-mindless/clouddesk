import type { Ticket } from '../api/types'

// done: zgłoszenie rozwiązane lub zamknięte, termin już nie obowiązuje
// breached: termin minął, warning: zostało mniej niż WARNING_RATIO czasu na reakcję
export type SlaState = 'done' | 'ok' | 'warning' | 'breached'

const WARNING_RATIO = 0.25

// Wystarczą te pola, więc funkcja działa też dla skróconych zgłoszeń z pulpitu (AtRiskTicket).
type SlaFields = Pick<Ticket, 'status' | 'createdAt' | 'slaDueAt'>

export function getSlaState(ticket: SlaFields, now: Date = new Date()): SlaState {
  if (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') return 'done'

  const created = Date.parse(ticket.createdAt)
  const due = Date.parse(ticket.slaDueAt)
  const remaining = due - now.getTime()

  if (remaining <= 0) return 'breached'
  if (remaining < (due - created) * WARNING_RATIO) return 'warning'
  return 'ok'
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
}

// Czas do terminu SLA słownie: „2 h 14 min”, „3 d 4 h”, „45 min”; po terminie z minusem („−3 h 12 min”).
// Dokładność do minuty – sekundy tylko by migały, a odliczanie odświeża się rzadziej niż co sekundę.
export function formatRemaining(ms: number): string {
  const sign = ms < 0 ? '−' : ''
  const minutes = Math.floor(Math.abs(ms) / 60_000)
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const mins = minutes % 60
  if (days > 0) return `${sign}${days} d${hours ? ` ${hours} h` : ''}`
  if (hours > 0) return `${sign}${hours} h${mins ? ` ${mins} min` : ''}`
  if (mins === 0) return `${sign}<1 min`
  return `${sign}${mins} min`
}

const shortDate = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
// Wpis z innego roku dostaje rok – inaczej zeszłoroczny „20 lis” wyglądałby jak świeży.
const shortDateWithYear = new Intl.DateTimeFormat('pl-PL', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

// Czas względny na osi historii (#139): „przed chwilą”, „5 min temu”, „3 h temu”, „2 d temu”, a starsze – data.
export function formatAgo(iso: string, now: number): string {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return '—'
  const minutes = Math.floor((now - at) / 60_000)
  if (minutes < 1) return 'przed chwilą'
  if (minutes < 60) return `${minutes} min temu`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)} h temu`
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / 1440)} d temu`
  const date = new Date(at)
  return (date.getFullYear() === new Date(now).getFullYear() ? shortDate : shortDateWithYear).format(date)
}
