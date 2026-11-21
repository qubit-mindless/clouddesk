import type { TicketPriority, TicketStatus, UserRole } from './types'

export const STATUS_LABEL: Record<TicketStatus, string> = {
  NEW: 'Nowe',
  ASSIGNED: 'Przypisane',
  IN_PROGRESS: 'W toku',
  RESOLVED: 'Rozwiązane',
  CLOSED: 'Zamknięte',
}

export const PRIORITY_LABEL: Record<TicketPriority, string> = {
  P1: 'P1 – krytyczny',
  P2: 'P2 – wysoki',
  P3: 'P3 – normalny',
  P4: 'P4 – niski',
}

export const ROLE_LABEL: Record<UserRole, string> = {
  REPORTER: 'Zgłaszający',
  TECHNICIAN: 'Technik',
  ADMIN: 'Administrator',
}
