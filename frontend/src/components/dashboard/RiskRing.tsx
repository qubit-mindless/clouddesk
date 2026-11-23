// Pierścień otwartych zgłoszeń: przekroczone, zagrożone i w terminie. Odcinki rysuje stroke-dasharray
// na okręgu o pathLength=100, więc długość odcinka to po prostu jego procent.
interface Props {
  breached: number
  atRisk: number
  open: number
}

const SEGMENTS = [
  { key: 'breached', className: 'ring-breached' },
  { key: 'atRisk', className: 'ring-warning' },
  { key: 'ok', className: 'ring-ok' },
] as const

export function RiskRing({ breached, atRisk, open }: Props) {
  const values = { breached, atRisk, ok: Math.max(open - breached - atRisk, 0) }
  const label = open
    ? `Otwarte zgłoszenia: ${open}. Przekroczone SLA: ${breached}, zagrożone: ${atRisk}, w terminie: ${values.ok}.`
    : 'Brak otwartych zgłoszeń.'

  // Początek każdego odcinka = suma poprzednich (liczona z góry, bez mutowania w trakcie renderu).
  // Mianownik nie mniejszy niż suma odcinków – gdyby liczby z API się nie zgadzały, pierścień nie zawinie się dwa razy.
  const total = Math.max(open, breached + atRisk)
  const shares = SEGMENTS.map(({ key }) => (total ? (values[key] / total) * 100 : 0))
  const starts = shares.map((_, i) => shares.slice(0, i).reduce((a, b) => a + b, 0))

  return (
    <svg className="risk-ring" viewBox="0 0 120 120" role="img" aria-label={label} data-testid="risk-ring">
      <circle className="ring-track" cx="60" cy="60" r="50" pathLength={100} />
      {SEGMENTS.map(({ key, className }, i) =>
        shares[i] > 0 ? (
          <circle
            key={key}
            className={className}
            cx="60"
            cy="60"
            r="50"
            pathLength={100}
            strokeDasharray={`${shares[i]} ${100 - shares[i]}`}
            strokeDashoffset={-starts[i]}
          />
        ) : null,
      )}
      <text x="60" y="58" className="ring-value">
        {breached + atRisk}
      </text>
      <text x="60" y="76" className="ring-caption">
        z {open} otwartych
      </text>
    </svg>
  )
}
