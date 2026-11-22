import { Link, Navigate, useSearchParams } from 'react-router'
import { PRIORITY_LABEL } from '../api/labels'
import { getStats } from '../api/stats'
import type { AtRiskTicket, Stats, TicketPriority } from '../api/types'
import { canManageTicket } from '../auth/permissions'
import { BarList } from '../components/dashboard/BarList'
import { RiskRing } from '../components/dashboard/RiskRing'
import { TrendChart } from '../components/dashboard/TrendChart'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { PriorityBadge } from '../components/PriorityBadge'
import { useAuth } from '../hooks/useAuth'
import { useNow } from '../hooks/useNow'
import { useRequest } from '../hooks/useRequest'
import { formatDateTime, formatRemaining, getSlaState } from '../utils/sla'

// Okresy do wyboru – API przyjmuje 7–90 dni, w UI wystarczą trzy.
const PERIODS = [7, 30, 90] as const
const DEFAULT_PERIOD = 30
const PRIORITIES: TicketPriority[] = ['P1', 'P2', 'P3', 'P4']

const number = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
const time = new Intl.DateTimeFormat('pl-PL', { timeStyle: 'short' })

function pickPeriod(value: string | null): number {
  const days = Number(value)
  return PERIODS.some((p) => p === days) ? days : DEFAULT_PERIOD
}

// Pulpit SLA (#138) dla technika i administratora. Zgłaszający nie ma tej strony – backend i tak zwróci 403.
export function DashboardPage() {
  const { user } = useAuth()
  return canManageTicket(user) ? <DashboardContent /> : <Navigate to="/tickets" replace />
}

function DashboardContent() {
  const [params, setParams] = useSearchParams()
  const days = pickPeriod(params.get('days'))
  const { data, error, loading, reload } = useRequest(String(days), (signal) => getStats(days, signal), { keepData: true })

  return (
    <>
      <div className="page-actions">
        <h2>Pulpit SLA</h2>
        <div className="period" role="group" aria-label="Okres" data-testid="dashboard-period">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={p === days}
              onClick={() => setParams(p === DEFAULT_PERIOD ? {} : { days: String(p) }, { replace: true })}
              data-testid={`dashboard-period-${p}`}
            >
              {p} dni
            </button>
          ))}
        </div>
      </div>
      {loading && !data && <Loading label="Ładowanie pulpitu…" />}
      {error !== undefined && <ErrorState error={error} onRetry={reload} />}
      {data && <Dashboard stats={data} refreshing={loading} onReload={reload} />}
    </>
  )
}

function Dashboard({ stats, refreshing, onReload }: { stats: Stats; refreshing: boolean; onReload: () => void }) {
  const { sla, days } = stats

  return (
    <div className="bento" aria-busy={refreshing} data-testid="dashboard">
      <section className="bento-tile tile-risk" aria-labelledby="tile-risk">
        <h3 id="tile-risk">Zagrożone SLA teraz</h3>
        <div className="risk">
          <RiskRing breached={sla.breachedOpen} atRisk={sla.atRisk} open={sla.open} />
          <ul className="risk-legend">
            <li className="legend-breached">Przekroczone: {sla.breachedOpen}</li>
            <li className="legend-warning">Zagrożone: {sla.atRisk}</li>
            <li className="legend-ok">W terminie: {Math.max(sla.open - sla.breachedOpen - sla.atRisk, 0)}</li>
          </ul>
        </div>
        <AtRiskList tickets={stats.atRiskTop} />
      </section>

      <Tile id="open" label="Otwarte" value={sla.open} hint="NEW, ASSIGNED i IN_PROGRESS" />
      <Tile
        id="breached"
        label="Przekroczone SLA"
        value={sla.breachedOpen}
        hint="otwarte po terminie"
        tone={sla.breachedOpen > 0 ? 'breached' : undefined}
      />
      <Tile
        id="compliance"
        label="Zgodność z SLA"
        value={sla.compliancePct === null ? '—' : `${number.format(sla.compliancePct)}%`}
        hint={
          sla.resolved
            ? `${sla.resolvedOnTime} z ${sla.resolved} zakończonych w terminie`
            : `brak zakończonych w ${days} dni`
        }
        title="Liczone tylko z zakończonych (RESOLVED i CLOSED) w wybranym okresie. Otwarte po terminie są w kafelku „Przekroczone SLA”."
      />
      <Tile
        id="mttr"
        label="Średni czas rozwiązania"
        value={stats.mttrHours === null ? '—' : `${number.format(stats.mttrHours)} h`}
        hint="MTTR: od utworzenia do rozwiązania"
      />

      <section className="bento-tile tile-trend" aria-labelledby="tile-trend">
        <h3 id="tile-trend">Utworzone i rozwiązane · {days} dni</h3>
        <TrendChart daily={stats.daily} />
      </section>

      <Tile
        id="ai"
        label="Odpowiedzi asystenta AI"
        value={stats.ai.answers}
        hint={`w ${stats.ai.tickets} zgłoszeniach`}
        tone="ai"
      />

      <section className="bento-tile tile-priority" aria-labelledby="tile-priority">
        <h3 id="tile-priority">Otwarte według priorytetu</h3>
        <BarList
          testId="dashboard-priority"
          bars={PRIORITIES.map((p) => ({
            key: p,
            label: PRIORITY_LABEL[p],
            value: stats.byPriority[p],
            className: `priority-${p.toLowerCase()}`,
          }))}
        />
      </section>

      <section className="bento-tile tile-techs" aria-labelledby="tile-techs">
        <h3 id="tile-techs">Obciążenie techników</h3>
        {stats.perTechnician.length ? (
          <BarList
            testId="dashboard-technicians"
            bars={stats.perTechnician.map((t) => ({
              key: t.login,
              label: t.fullName,
              value: t.open,
              detail: `· rozwiązane: ${t.resolved}`,
            }))}
          />
        ) : (
          <p className="tile-hint">Brak techników.</p>
        )}
      </section>

      <p className="bento-footer">
        {refreshing ? 'Odświeżanie…' : `Dane z ${time.format(new Date(stats.generatedAt))}`} ·{' '}
        <button type="button" className="link-button" onClick={onReload} data-testid="dashboard-reload">
          Odśwież
        </button>
      </p>
    </div>
  )
}

interface TileProps {
  id: string
  label: string
  value: number | string
  hint: string
  title?: string
  tone?: 'breached' | 'ai'
}

function Tile({ id, label, value, hint, title, tone }: TileProps) {
  return (
    <section className={`bento-tile tile-small ${tone ? `tile-${tone}` : ''}`} aria-labelledby={`tile-${id}`} title={title} data-testid={`tile-${id}`}>
      <h3 id={`tile-${id}`}>{label}</h3>
      <p className="tile-value">{value}</p>
      <p className="tile-hint">{hint}</p>
    </section>
  )
}

// Lista najpilniejszych z odliczaniem. Jeden wspólny timer (useNow) dla wszystkich wierszy; liczby nie trafiają
// do aria-live, żeby czytnik ekranu nie odczytywał ich co chwilę.
function AtRiskList({ tickets }: { tickets: AtRiskTicket[] }) {
  const now = useNow(30_000)
  if (tickets.length === 0) {
    return <p className="tile-hint" data-testid="at-risk-empty">Żadne otwarte zgłoszenie nie jest zagrożone.</p>
  }
  return (
    <ol className="at-risk" data-testid="at-risk-list">
      {tickets.map((t) => {
        const state = getSlaState(t, new Date(now))
        const remaining = Date.parse(t.slaDueAt) - now
        return (
          <li key={t.id} data-testid={`at-risk-${t.id}`}>
            <PriorityBadge priority={t.priority} />
            <Link to={`/tickets/${t.id}`} title={t.title}>
              {t.title}
            </Link>
            <span className={`sla sla-${state}`} title={`Termin SLA: ${formatDateTime(t.slaDueAt)}`}>
              {state === 'breached' ? `po terminie ${formatRemaining(-remaining)}` : `zostało ${formatRemaining(remaining)}`}
            </span>
          </li>
        )
      })}
    </ol>
  )
}
