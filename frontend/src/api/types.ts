export type TicketStatus = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4'

export interface Ticket {
  id: number
  title: string
  description: string
  status: TicketStatus
  priority: TicketPriority
  reporter: string
  assignee: string | null
  createdAt: string
  updatedAt: string
  slaDueAt: string
  // Kiedy zgłoszenie przeszło do RESOLVED/CLOSED; null, dopóki jest otwarte (ponowne otwarcie zeruje).
  resolvedAt: string | null
}

// Ciała żądań do POST i PATCH /tickets. Termin SLA, zgłaszającego i daty ustala backend.
export interface TicketCreate {
  title: string
  description: string
  priority: TicketPriority
}

export type TicketUpdate = Partial<TicketCreate & Pick<Ticket, 'status' | 'assignee'>>

export interface TicketQuery {
  status?: TicketStatus
  priority?: TicketPriority
}

export interface AssistantMessage {
  id: number
  role: 'user' | 'assistant'
  // Login autora pytania; null dla odpowiedzi asystenta.
  author: string | null
  content: string
  createdAt: string
}

// Odpowiedź GET i POST /tickets/{id}/assistant: cała rozmowa, flaga konfiguracji i pozostały limit pytań.
// Pytać może tylko zgłaszający, dopóki zgłoszenie nie jest rozwiązane; technik widzi rozmowę do odczytu.
export interface AssistantConversation {
  items: AssistantMessage[]
  enabled: boolean
  remaining: number
  canAsk: boolean
  readOnlyReason: 'not_reporter' | 'resolved' | null
}

// Kontrakty nowych endpointów (#142) – opis pól, ról i kodów błędów w docs/api-kontrakty.md.

// POST /tickets/{id}/assistant/summary (#143, opcjonalne): podsumowanie rozmowy dla technika.
export interface AssistantSummary {
  problem: string
  checked: string[]
  errors: string[]
  nextStep: string
  generatedAt: string
}

// GET /tickets/{id}/history (#139): jedna zmiana jednego pola, od najstarszej.
export type HistoryField = 'status' | 'priority' | 'assignee' | 'title' | 'description'

export interface TicketHistoryEntry {
  id: number
  field: HistoryField
  oldValue: string | null
  newValue: string | null
  author: string
  authorName: string
  changedAt: string
}

export interface TicketHistory {
  items: TicketHistoryEntry[]
}

// GET /stats?days=30 (#138): pulpit SLA dla technika i administratora.
export interface SlaStats {
  open: number
  breachedOpen: number
  atRisk: number
  resolved: number
  resolvedOnTime: number
  compliancePct: number | null
}

export interface TechnicianStats {
  login: string
  fullName: string
  open: number
  resolved: number
}

export interface DailyStats {
  date: string
  created: number
  resolved: number
}

export type AtRiskTicket = Pick<Ticket, 'id' | 'title' | 'priority' | 'status' | 'assignee' | 'createdAt' | 'slaDueAt'>

export interface Stats {
  days: number
  generatedAt: string
  byStatus: Record<TicketStatus, number>
  byPriority: Record<TicketPriority, number>
  sla: SlaStats
  mttrHours: number | null
  perTechnician: TechnicianStats[]
  daily: DailyStats[]
  ai: { answers: number; tickets: number }
  atRiskTop: AtRiskTicket[]
}

// GET /health (#140): publiczny stan wdrożenia. Pola rewizji, repliki i regionu są null poza Azure.
export interface Health {
  status: 'UP' | 'DOWN'
  database: 'CONNECTED' | 'DISCONNECTED'
  version: string
  commit: string
  timestamp: string
  revision: string | null
  replica: string | null
  region: string | null
  startedAt: string
  assistant: 'ENABLED' | 'DISABLED'
}

export type UserRole = 'REPORTER' | 'TECHNICIAN' | 'ADMIN'

export interface User {
  id: number
  email: string
  login: string
  fullName: string
  role: UserRole
}

// Odpowiedź POST /auth/login (kontrakt z #106).
export interface LoginResponse {
  accessToken: string
  tokenType: 'bearer'
  expiresIn: number
  user: User
}
