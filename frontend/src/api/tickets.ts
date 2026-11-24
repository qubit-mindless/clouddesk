import { request } from './client'
import type { Ticket, TicketCreate, TicketHistory, TicketPage, TicketQuery, TicketUpdate } from './types'

// API przyjmuje size 1–100 – więcej zgłoszeń wczytujemy kolejnymi stronami.
const MAX_PAGE_SIZE = 100
// Górna granica jednej listy: lista odświeża się w tle, więc każde odświeżenie pobiera wszystkie wczytane strony.
// Dalej – zawęzić filtrem albo wyszukiwaniem.
export const MAX_TICKETS = 500

export interface TicketSlice {
  items: Ticket[]
  // Ile zgłoszeń pasuje do filtrów łącznie – lista pokazuje „Pokazano X z Y”.
  total: number
}

// Pierwsze `limit` zgłoszeń pasujących do filtrów, od najnowszych (tak sortuje backend). Bez tego lista pokazywała
// po cichu tylko domyślne 50.
export async function getTickets(query: TicketQuery = {}, limit = MAX_PAGE_SIZE, signal?: AbortSignal): Promise<TicketSlice> {
  // Ten sam rozmiar strony na każdej stronie – inaczej przesunięcia stron by się rozjechały.
  const size = Math.min(limit, MAX_PAGE_SIZE)
  const filters = Object.entries(query).filter(([, value]) => value) as [string, string][]
  const fetchPage = (page: number) =>
    request<TicketPage>(`/tickets?${new URLSearchParams([...filters, ['page', String(page)], ['size', String(size)]])}`, { signal })
  // Pierwsza strona mówi, ile jest wszystkich; pozostałe (najwyżej do `limit`) – równolegle.
  const first = await fetchPage(1)
  const pages = Math.min(Math.ceil(limit / size), Math.ceil(first.total / size))
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => fetchPage(i + 2)))
  // Nowe zgłoszenie między stronami przesuwa kolejne – Map po id usuwa ewentualny duplikat.
  const items = new Map<number, Ticket>()
  for (const page of [first, ...rest]) for (const ticket of page.items) items.set(ticket.id, ticket)
  return { items: [...items.values()].slice(0, limit), total: first.total }
}

export function getTicket(id: number, signal?: AbortSignal): Promise<Ticket> {
  return request<Ticket>(`/tickets/${id}`, { signal })
}

export function createTicket(data: TicketCreate): Promise<Ticket> {
  return request<Ticket>('/tickets', { method: 'POST', body: JSON.stringify(data) })
}

export function updateTicket(id: number, data: TicketUpdate): Promise<Ticket> {
  return request<Ticket>(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

// „Pomogło – zamknij”: zgłaszający sam zamyka własne zgłoszenie po pomocy asystenta AI (RESOLVED, resolution = SELF_AI).
export function resolveTicket(id: number): Promise<Ticket> {
  return request<Ticket>(`/tickets/${id}/resolve`, { method: 'POST', body: '{}' })
}

export function deleteTicket(id: number): Promise<void> {
  return request<void>(`/tickets/${id}`, { method: 'DELETE' })
}

// Oś historii zgłoszenia (#139): zmiany od najstarszej. Utworzenia tu nie ma – to createdAt i reporter zgłoszenia.
export function getTicketHistory(id: number, signal?: AbortSignal): Promise<TicketHistory> {
  return request<TicketHistory>(`/tickets/${id}/history`, { signal })
}
