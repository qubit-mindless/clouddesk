import { useSearchParams } from 'react-router'
import { getTickets } from '../api/tickets'
import { TicketFilters, type TicketFilterValues } from '../components/TicketFilters'
import { TicketList } from '../components/TicketList'

export function TicketListPage() {
  // Filtry siedzą w adresie (?status=&priority=&q=), więc powrót ze szczegółów ich nie gubi.
  const [params, setParams] = useSearchParams()
  const filters: TicketFilterValues = {
    status: (params.get('status') ?? '') as TicketFilterValues['status'],
    priority: (params.get('priority') ?? '') as TicketFilterValues['priority'],
    query: params.get('q') ?? '',
  }

  const handleChange = (next: TicketFilterValues) => {
    const entries = Object.entries({ status: next.status, priority: next.priority, q: next.query })
    setParams(entries.filter(([, value]) => value !== ''), { replace: true })
  }

  const query = filters.query.trim().toLowerCase()
  const tickets = getTickets().filter(
    (t) =>
      (!filters.status || t.status === filters.status) &&
      (!filters.priority || t.priority === filters.priority) &&
      (!query || t.title.toLowerCase().includes(query)),
  )

  return (
    <>
      <TicketFilters values={filters} onChange={handleChange} />
      <TicketList tickets={tickets} />
    </>
  )
}
