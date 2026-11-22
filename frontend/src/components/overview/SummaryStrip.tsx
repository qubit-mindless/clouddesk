import type { MeSummary } from '../../api/types'
import { formatDateTime } from '../../utils/sla'
import { greeting, plural } from '../../utils/time'

// Nad listą technika: powitanie z jednym zdaniem „co na mnie czeka” i cztery liczniki z /me/summary.

function Sparkline({ values, tone }: { values: number[]; tone: string }) {
  const max = Math.max(1, ...values)
  const step = 100 / Math.max(1, values.length - 1)
  const points = values.map((v, i) => `${(i * step).toFixed(1)},${(24 - (v / max) * 20).toFixed(1)}`).join(' ')
  return (
    <svg className="kpi-spark" viewBox="0 0 100 26" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={points} fill="none" stroke={tone} strokeWidth="2" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export function Hello({ name, summary }: { name: string; summary?: MeSummary }) {
  const mine = summary?.mine
  return (
    <div className="hello">
      <h2>
        {greeting()}, {name}
      </h2>
      {mine && (
        <p data-testid="hello-summary">
          {mine.open === 0 ? (
            'Nie masz przypisanych otwartych zgłoszeń.'
          ) : (
            <>
              Na Ciebie {mine.open === 1 ? 'czeka' : 'czekają'} <b>{mine.open}</b> {plural(mine.open, 'zgłoszenie', 'zgłoszenia', 'zgłoszeń')}
              {mine.breached > 0 && (
                <>
                  , <b className="tone-bad">{mine.breached} po terminie</b>
                </>
              )}
              {mine.atRisk > 0 && (
                <>
                  , <b className="tone-warn">{mine.atRisk} blisko terminu</b>
                </>
              )}
              .{mine.nextDueAt && <> Najbliższy termin: {formatDateTime(mine.nextDueAt)}.</>}
            </>
          )}
        </p>
      )}
    </div>
  )
}

export function SummaryStrip({ summary }: { summary: MeSummary }) {
  const team = summary.team
  if (!team) return null
  const created = team.last7Days.map((d) => d.created)
  const resolved = team.last7Days.map((d) => d.resolved)
  return (
    <div className="kpis" role="group" aria-label="Podsumowanie" data-testid="summary-strip">
      <div className="kpi">
        <span className="kpi-label">Moje otwarte</span>
        <span className="kpi-value">{summary.mine.open}</span>
      </div>
      <div className={`kpi${team.breached ? ' kpi-bad' : ''}`}>
        <span className="kpi-label">Po terminie (wszystkie)</span>
        <span className="kpi-value">{team.breached}</span>
      </div>
      <div className={`kpi${team.atRisk ? ' kpi-warn' : ''}`}>
        <span className="kpi-label">Blisko terminu</span>
        <span className="kpi-value">{team.atRisk}</span>
      </div>
      <div className="kpi">
        <span className="kpi-label">Nowe · rozwiązane dziś</span>
        <span className="kpi-value">
          {team.createdToday} · {team.resolvedToday}
        </span>
        <Sparkline values={created} tone="var(--plasma)" />
        <Sparkline values={resolved} tone="var(--tidal)" />
        <span className="visually-hidden">
          Ostatnie 7 dni – utworzone: {created.join(', ')}; rozwiązane: {resolved.join(', ')}.
        </span>
      </div>
    </div>
  )
}

export function AiTodayCard({ summary }: { summary: MeSummary }) {
  const ai = summary.aiToday
  if (!ai) return null
  const total = Math.max(1, ai.conversations)
  return (
    <section className="side-card" aria-labelledby="ai-today-heading" data-testid="ai-today">
      <h3 id="ai-today-heading">✦ Asystent AI dziś</h3>
      {ai.conversations === 0 ? (
        <p className="muted">Dziś nikt jeszcze nie rozmawiał z asystentem.</p>
      ) : (
        <>
          <div className="ai-meter" role="img" aria-label={`Z ${ai.conversations} rozmów: ${ai.resolvedByReporter} zamknięte bez technika, ${ai.handedOver} przekazane technikowi`}>
            <i style={{ width: `${(ai.resolvedByReporter / total) * 100}%`, background: 'var(--green-fg)' }} />
            <i style={{ width: `${(ai.handedOver / total) * 100}%`, background: 'var(--plasma)' }} />
          </div>
          <dl className="ai-rows">
            <dt>
              <span className="dot" style={{ background: 'var(--green-fg)' }} /> rozwiązane bez technika
            </dt>
            <dd>{ai.resolvedByReporter}</dd>
            <dt>
              <span className="dot" style={{ background: 'var(--plasma)' }} /> przekazane z rozmową
            </dt>
            <dd>{ai.handedOver}</dd>
            <dt className="muted">odpowiedzi asystenta</dt>
            <dd className="muted">{ai.answers}</dd>
          </dl>
        </>
      )}
    </section>
  )
}
