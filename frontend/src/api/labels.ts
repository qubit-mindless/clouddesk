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

// Kod z historii lub powiadomienia (string, bo backend może dodać nowy) → etykieta; nieznany kod bez zmian, brak → „—”.
export const statusLabel = (code: string | null): string => (code ? (STATUS_LABEL[code as TicketStatus] ?? code) : '—')
export const priorityLabel = (code: string | null): string => (code ? (PRIORITY_LABEL[code as TicketPriority] ?? code) : '—')
