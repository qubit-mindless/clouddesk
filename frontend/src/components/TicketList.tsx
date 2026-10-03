import type { Ticket } from '../api/types'

const STATUS_LABEL: Record<Ticket['status'], string> = {
  NEW: 'Nowe',
  ASSIGNED: 'Przypisane',
  IN_PROGRESS: 'W toku',
  RESOLVED: 'Rozwiązane',
  CLOSED: 'Zamknięte',
}

export function TicketList({ tickets }: { tickets: Ticket[] }) {
  return (
    <table data-testid="ticket-list">
      <thead>
        <tr>
          <th>#</th>
          <th>Tytuł</th>
          <th>Priorytet</th>
          <th>Status</th>
          <th>Technik</th>
          <th>Termin SLA</th>
        </tr>
      </thead>
      <tbody>
        {tickets.map((t) => (
          <tr key={t.id}>
            <td>{t.id}</td>
            <td>{t.title}</td>
            <td>{t.priority}</td>
            <td>{STATUS_LABEL[t.status]}</td>
            <td>{t.assignee ?? '—'}</td>
            <td>{new Date(t.slaDueAt).toLocaleString('pl-PL')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
