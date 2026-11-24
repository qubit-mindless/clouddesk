import type { HistoryField, Ticket, TicketPriority, TicketStatus, User } from '../src/api/types.ts'

// Dane demo udawanego API: zgłoszenia z src/mocks/tickets.json przesunięte do „teraz” i ok. 60 zgłoszeń
// zamkniętych w ostatnich 30 dniach, z historią zmian. Generator jest deterministyczny (stałe ziarno),
// więc po restarcie serwera pulpit wygląda tak samo – zmienia się tylko odniesienie do bieżącej daty.

export interface FakeHistoryEntry {
  id: number
  ticketId: number
  field: HistoryField
  oldValue: string | null
  newValue: string | null
  author: string
  changedAt: string
}

export const SLA_HOURS: Record<TicketPriority, number> = { P1: 4, P2: 8, P3: 48, P4: 120 }
export const CLOSED_STATUSES: readonly TicketStatus[] = ['RESOLVED', 'CLOSED']

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const GENERATED_COUNT = 60
const WINDOW_DAYS = 30

const TITLES = [
  'Brak dostępu do folderu działu na dysku sieciowym',
  'Outlook nie synchronizuje kalendarza',
  'Laptop nie łączy się z Wi-Fi w sali konferencyjnej',
  'Reset hasła do systemu kadrowego',
  'Monitor zewnętrzny miga po podłączeniu do stacji dokującej',
  'Teams zawiesza się przy udostępnianiu ekranu',
  'Prośba o instalację programu do PDF',
  'Drukarka sieciowa drukuje puste strony',
  'Konto zablokowane po kilku nieudanych logowaniach',
  'Wolne działanie komputera po aktualizacji',
  'Nowy pracownik – założenie konta i skrzynki',
  'Nie działa skaner na 1. piętrze',
  'Błąd certyfikatu przy wejściu do intranetu',
  'Brak dźwięku w słuchawkach USB',
  'Uprawnienia do edycji arkusza budżetu',
  'Telefon służbowy nie odbiera poczty',
]

// mulberry32 – mały generator liczb pseudolosowych z ziarnem.
function random(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

export function slaDueAt(createdAt: string, priority: TicketPriority): string {
  return iso(Date.parse(createdAt) + SLA_HOURS[priority] * HOUR_MS)
}

export function buildDemoData(mocks: Ticket[], users: User[], now = Date.now()) {
  const rand = random(20261122)
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]
  const technicians = users.filter((u) => u.role === 'TECHNICIAN').map((u) => u.login)
  const reporters = users.filter((u) => u.role === 'REPORTER').map((u) => u.login)

  const history: FakeHistoryEntry[] = []
  let nextHistoryId = 1
  const record = (ticketId: number, field: HistoryField, oldValue: string | null, newValue: string | null, author: string, at: number) => {
    history.push({ id: nextHistoryId++, ticketId, field, oldValue, newValue, author, changedAt: iso(Math.min(at, now)) })
  }

  // Przebieg zgłoszenia: przypisanie, praca, rozwiązanie, zamknięcie – tylko do stanu, w którym jest teraz.
  const STEPS: TicketStatus[] = ['NEW', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']
  const recordLifecycle = (ticket: Ticket, resolvedMs: number | null) => {
    if (!ticket.assignee) return
    const created = Date.parse(ticket.createdAt)
    const end = resolvedMs ?? now
    const at = [created, created + (end - created) * 0.1, created + (end - created) * 0.3, end, end + DAY_MS]
    record(ticket.id, 'assignee', null, ticket.assignee, ticket.assignee, at[1])
    const last = STEPS.indexOf(ticket.status)
    for (let step = 1; step <= last; step++) {
      record(ticket.id, 'status', STEPS[step - 1], STEPS[step], ticket.assignee, at[step])
    }
  }

  // Najnowsze zgłoszenie z mocków ma powstać 40 min temu – reszta przesuwa się o tyle samo.
  const newest = Math.max(...mocks.map((t) => Date.parse(t.createdAt)))
  const shift = now - 40 * 60_000 - newest
  const tickets: Ticket[] = mocks.map((mock) => {
    const createdMs = Date.parse(mock.createdAt) + shift
    const priority = mock.priority
    const closed = CLOSED_STATUSES.includes(mock.status)
    const resolvedMs = closed ? createdMs + SLA_HOURS[priority] * HOUR_MS * 0.6 : null
    const ticket: Ticket = {
      ...mock,
      createdAt: iso(createdMs),
      updatedAt: iso(resolvedMs ?? createdMs),
      slaDueAt: slaDueAt(iso(createdMs), priority),
      resolvedAt: resolvedMs === null ? null : iso(resolvedMs),
    }
    recordLifecycle(ticket, resolvedMs)
    return ticket
  })

  let nextId = Math.max(...tickets.map((t) => t.id)) + 1
  for (let i = 0; i < GENERATED_COUNT; i++) {
    const roll = rand()
    const priority: TicketPriority = roll < 0.1 ? 'P1' : roll < 0.35 ? 'P2' : roll < 0.75 ? 'P3' : 'P4'
    const createdMs = now - rand() * WINDOW_DAYS * DAY_MS
    // Ok. 1/5 zgłoszeń kończy się po terminie SLA – inaczej pulpit pokazywałby wieczne 100%.
    const resolvedMs = createdMs + SLA_HOURS[priority] * HOUR_MS * (0.15 + rand() * 1.1)
    const done = resolvedMs < now
    const status: TicketStatus = !done ? 'IN_PROGRESS' : now - resolvedMs > 3 * DAY_MS && rand() < 0.5 ? 'CLOSED' : 'RESOLVED'
    const ticket: Ticket = {
      id: nextId++,
      title: pick(TITLES),
      description: 'Zgłoszenie wygenerowane do danych demo udawanego API.',
      status,
      priority,
      reporter: pick(reporters),
      reporterName: '',
      assignee: pick(technicians),
      assigneeName: null,
      createdAt: iso(createdMs),
      updatedAt: iso(done ? resolvedMs : createdMs),
      slaDueAt: slaDueAt(iso(createdMs), priority),
      resolvedAt: done ? iso(resolvedMs) : null,
    }
    recordLifecycle(ticket, done ? resolvedMs : null)
    tickets.push(ticket)
  }

  // „Ostatnia zmiana” = najnowszy wpis historii (np. zamknięcie dzień po rozwiązaniu), nie data utworzenia.
  for (const entry of history) {
    const ticket = tickets.find((t) => t.id === entry.ticketId)
    if (ticket && entry.changedAt > ticket.updatedAt) ticket.updatedAt = entry.changedAt
  }
  tickets.sort((a, b) => a.id - b.id)
  return { tickets, history, nextHistoryId }
}
