import type { DailyStats } from '../../api/types'

// Utworzone i rozwiązane dziennie jako dwie linie. Rozwiązane są przerywane, więc serie różni nie tylko kolor.
// Dla czytników ekranu obok jest ukryta tabela z tymi samymi liczbami.
const W = 300
const H = 90
const PAD = 4

const dayLabel = new Intl.DateTimeFormat('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const formatDay = (date: string) => dayLabel.format(new Date(`${date}T00:00:00Z`))

function points(values: number[], max: number): string {
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0
  return values.map((v, i) => `${(PAD + i * step).toFixed(1)},${(H - PAD - (v / max) * (H - PAD * 2)).toFixed(1)}`).join(' ')
}

export function TrendChart({ daily }: { daily: DailyStats[] }) {
  const created = daily.map((d) => d.created)
  const resolved = daily.map((d) => d.resolved)
  const peak = Math.max(0, ...created, ...resolved)
  const max = Math.max(1, peak) // tylko do skali – przy samych zerach linie leżą na osi
  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
  const first = daily[0]?.date
  const last = daily.at(-1)?.date

  return (
    <figure className="trend">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true" data-testid="trend-chart">
        <line className="trend-axis" x1={PAD} x2={W - PAD} y1={H - PAD} y2={H - PAD} />
        <polyline className="trend-created" points={points(created, max)} />
        <polyline className="trend-resolved" points={points(resolved, max)} />
      </svg>
      {first && last && (
        <div className="trend-range" aria-hidden="true">
          <span>{formatDay(first)}</span>
          <span>max {peak} dziennie</span>
          <span>{formatDay(last)}</span>
        </div>
      )}
      <figcaption className="trend-legend">
        <span className="legend-created">Utworzone: {sum(created)}</span>
        <span className="legend-resolved">Rozwiązane: {sum(resolved)}</span>
      </figcaption>
      <table className="visually-hidden">
        <caption>Zgłoszenia utworzone i rozwiązane dziennie</caption>
        <thead>
          <tr>
            <th scope="col">Dzień</th>
            <th scope="col">Utworzone</th>
            <th scope="col">Rozwiązane</th>
          </tr>
        </thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.date}>
              <th scope="row">{formatDay(d.date)}</th>
              <td>{d.created}</td>
              <td>{d.resolved}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  )
}
