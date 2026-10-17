import mockTickets from '../mocks/tickets.json'
import type { Ticket } from './types'

// Blok 4: dane makietowe. W Bloku 6 (#16) te funkcje zaczną wołać GET ${API_BASE_URL}/tickets,
// a komponenty korzystające z nich zostaną bez zmian.
const tickets = mockTickets as Ticket[]

export function getTickets(): Ticket[] {
  return tickets
}

export function getTicket(id: number): Ticket | undefined {
  return tickets.find((t) => t.id === id)
}
