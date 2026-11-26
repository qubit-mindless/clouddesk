import type { Ticket, User } from '../api/types'
import { isClosed } from '../utils/ticket'

// Te same reguły co w TicketService backendu (#106). UI tylko ukrywa niedozwolone akcje –
// o uprawnieniach decyduje backend (403/404), a jego komunikat pokazujemy, gdyby UI się rozjechał.

function isStaff(user: User | null): boolean {
  return user?.role === 'TECHNICIAN' || user?.role === 'ADMIN'
}

// Technik i administrator prowadzą zgłoszenie: zmieniają status i przypisanie.
export function canManageTicket(user: User | null): boolean {
  return isStaff(user)
}

// Zgłaszający poprawia tylko treść i priorytet własnych zgłoszeń, dopóki nie są rozwiązane ani zamknięte.
export function canEditTicket(user: User | null, ticket: Ticket): boolean {
  if (isStaff(user)) return true
  return user !== null && ticket.reporter === user.login && !isClosed(ticket)
}

export function canDeleteTicket(user: User | null): boolean {
  return isStaff(user)
}
