import { TicketList } from './components/TicketList'
import mockTickets from './mocks/tickets.json'
import type { Ticket } from './api/types'

// Blok 4: dane makietowe. W Bloku 6 zastąpimy je wywołaniem GET ${API_BASE_URL}/tickets.
const tickets = mockTickets as Ticket[]

export default function App() {
  return (
    <main>
      <h1>CloudDesk</h1>
      <p>System zgłoszeń IT z SLA i asystentem AI</p>
      <TicketList tickets={tickets} />
    </main>
  )
}
