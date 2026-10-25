import { request } from './client'
import type { Ticket, TicketCreate, TicketQuery, TicketUpdate } from './types'

// Lista może przyjść jako tablica albo strona { items, total, page, size } (paginacja z #13).
type TicketListResponse = Ticket[] | { items: Ticket[] }

export async function getTickets(query: TicketQuery = {}, signal?: AbortSignal): Promise<Ticket[]> {
  const params = new URLSearchParams(Object.entries(query).filter(([, value]) => value) as [string, string][])
  const search = params.size ? `?${params}` : ''
  const body = await request<TicketListResponse>(`/tickets${search}`, { signal })
  return Array.isArray(body) ? body : body.items
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

export function deleteTicket(id: number): Promise<void> {
  return request<void>(`/tickets/${id}`, { method: 'DELETE' })
}
