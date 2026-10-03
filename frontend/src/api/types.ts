export type TicketStatus = 'NEW' | 'ASSIGNED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED'
export type TicketPriority = 'P1' | 'P2' | 'P3' | 'P4'

export interface Ticket {
  id: number
  title: string
  status: TicketStatus
  priority: TicketPriority
  reporter: string
  assignee: string | null
  createdAt: string
  slaDueAt: string
}
