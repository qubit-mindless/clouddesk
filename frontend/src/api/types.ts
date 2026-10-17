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
  slaDueAt: string
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
