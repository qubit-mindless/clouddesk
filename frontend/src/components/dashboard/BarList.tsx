// Poziome słupki z liczbą obok etykiety – liczba jest tekstem, więc słupek to tylko podpowiedź wizualna.
interface Bar {
  key: string
  label: string
  value: number
  className?: string
  detail?: string
}

export function BarList({ bars, testId }: { bars: Bar[]; testId: string }) {
  const max = Math.max(1, ...bars.map((b) => b.value))
  return (
    <ul className="bar-list" data-testid={testId}>
      {bars.map((b) => (
        <li key={b.key}>
          <span className="bar-label">
            {b.label}
            {b.detail && <small> {b.detail}</small>}
          </span>
          <strong className="bar-value">{b.value}</strong>
          <span className="bar-track" aria-hidden="true">
            {b.value > 0 && <span className={`bar-fill ${b.className ?? ''}`} style={{ width: `${(b.value / max) * 100}%` }} />}
          </span>
        </li>
      ))}
    </ul>
  )
}
