import { useState, type ReactNode } from 'react'
import { getHealth } from '../api/health'
import type { Health } from '../api/types'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { APP_VERSION, REPO_URL } from '../config'
import { useRequest } from '../hooks/useRequest'

// Pierwsze żądanie po dłuższej przerwie budzi backend ze skali 0 (Container Apps, min_replicas = 0). Wolna odpowiedź
// to wybudzenie tylko wtedy, gdy replika wstała przed chwilą – inaczej to po prostu wolna sieć.
const COLD_START_MS = 5000
const FRESH_REPLICA_MS = 90_000

function isColdStart({ health, ms }: Measured) {
  return ms > COLD_START_MS && Date.parse(health.timestamp) - Date.parse(health.startedAt) < FRESH_REPLICA_MS
}

// Migawka z README (sekcja „Monitoring i FinOps”) – strona nie odpytuje Azure o koszty; aktualizować razem z README.
const FINOPS = { month: 'listopad 2026', asOf: '24.11.2026', cost: '5,17 €', forecast: 'ok. 6,50 €', budget: '35 €' }

interface Measured {
  health: Health
  ms: number
}

// Czas mierzony w przeglądarce: Internet → Nginx → backend → SELECT 1 w bazie i z powrotem.
async function measureHealth(signal: AbortSignal): Promise<Measured> {
  const start = performance.now()
  const health = await getHealth(signal)
  return { health, ms: Math.round(performance.now() - start) }
}

// SHA prowadzi do commita na GitHubie; „local” (build bez SHA) zostaje zwykłym tekstem.
function Commit({ sha, testId }: { sha: string; testId: string }) {
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return <code data-testid={testId}>{sha}</code>
  return (
    <a href={`${REPO_URL}/commit/${sha}`} target="_blank" rel="noreferrer" title={sha} data-testid={testId}>
      <code>{sha.slice(0, 7)}</code>
    </a>
  )
}

function formatDateTimeSeconds(iso: string) {
  return new Date(iso).toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'medium' })
}

function formatUptime(fromIso: string, toIso: string) {
  const minutes = Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 60000))
  if (minutes < 1) return 'niecałą minutę'
  const days = Math.floor(minutes / 1440)
  const hours = Math.floor((minutes % 1440) / 60)
  const parts = [days && `${days} d`, hours && `${hours} h`, `${minutes % 60} min`]
  return parts.filter(Boolean).join(' ')
}

function seconds(ms: number) {
  return (ms / 1000).toLocaleString('pl-PL', { maximumFractionDigits: 1 })
}

function Tile({ title, ok, children, testId }: { title: string; ok: boolean; children: ReactNode; testId: string }) {
  return (
    <section className="status-tile" data-testid={testId}>
      <h3>
        <span className={`status-dot ${ok ? 'status-dot-ok' : 'status-dot-down'}`} aria-hidden="true" />
        {title}
        <span className="visually-hidden">{ok ? ' – działa' : ' – nie działa'}</span>
      </h3>
      <dl>{children}</dl>
    </section>
  )
}

const LAYERS = [
  { name: 'Internet', where: 'przeglądarka' },
  { name: 'Nginx', where: 'vm-web · snet-web' },
  { name: 'Container Apps', where: 'backend · snet-app' },
  { name: 'PostgreSQL', where: 'Flexible Server · snet-db' },
] as const

function Architecture({ health }: { health: Health }) {
  // Odpowiedź z backendu oznacza, że Internet, Nginx i Container Apps działają; bazę ocenia sam backend.
  const ok = [true, true, true, health.database === 'CONNECTED']
  // Bez rewizji Container Apps backend nie działa w Azure (np. lokalnie) – układ warstw jest wtedy tylko poglądowy.
  const where = health.revision === null ? ' Backend działa poza Azure – układ warstw jak na produkcji.' : ''
  const summary = `Droga żądania: Internet → Nginx na vm-web (podsieć snet-web) → backend w Container Apps (snet-app) → PostgreSQL (snet-db). Baza: ${ok[3] ? 'połączona' : 'niedostępna'}.${where}`
  return (
    <figure className="status-architecture" data-testid="status-architecture">
      {/* Diagram jest dla oka; czytnik ekranu dostaje ten sam opis z podpisu. */}
      <ol aria-hidden="true">
        {LAYERS.map((layer, i) => (
          <li key={layer.name} className={ok[i] ? 'layer-ok' : 'layer-down'}>
            <strong>{layer.name}</strong>
            <span>{layer.where}</span>
          </li>
        ))}
      </ol>
      <figcaption>{summary}</figcaption>
    </figure>
  )
}

export function StatusPage() {
  // Jedno żądanie przy wejściu i na przycisk – bez automatycznego odświeżania (każde budzi backend).
  const { data: fresh, error, loading, reload } = useRequest('status', measureHealth)
  // Przy odświeżaniu zostaje poprzedni wynik – wybudzenie backendu może trwać kilkanaście sekund.
  const [data, setData] = useState<Measured>()
  if (fresh && fresh !== data) setData(fresh)
  const health = data?.health
  const sameVersion = health && health.commit === APP_VERSION

  return (
    <>
      <div className="page-actions">
        <h2>Stan systemu</h2>
        <button type="button" onClick={reload} disabled={loading} data-testid="status-refresh">
          {loading && data ? 'Sprawdzanie…' : 'Odśwież'}
        </button>
      </div>

      {loading && !data && <Loading label="Sprawdzanie stanu…" />}
      {error !== undefined && <ErrorState error={error} onRetry={reload} />}

      {data && health && (
        <>
          <p
            className={`status-summary ${health.status === 'UP' ? 'status-summary-ok' : 'status-summary-down'}`}
            role="status"
            data-testid="status-summary"
          >
            {health.status === 'UP' ? 'Wszystkie warstwy działają.' : 'Backend działa, ale baza danych nie odpowiada.'}
            {isColdStart(data) && (
              <span data-testid="status-cold-start">
                {' '}
                Backend wybudzony ze skali 0 w {seconds(data.ms)} s.
              </span>
            )}
          </p>

          <Architecture health={health} />

          <div className="status-grid">
            <Tile title="Frontend" ok testId="status-frontend">
              <dt>Wersja (commit)</dt>
              <dd>
                <Commit sha={APP_VERSION} testId="status-frontend-commit" />
              </dd>
              <dt>Serwer</dt>
              <dd>Nginx na vm-web</dd>
              {!sameVersion && APP_VERSION !== 'local' && (
                <>
                  <dt>Uwaga</dt>
                  <dd data-testid="status-version-mismatch">inna wersja niż backend – wdrożenie w toku?</dd>
                </>
              )}
            </Tile>

            <Tile title="Backend" ok testId="status-backend">
              <dt>Wersja (commit)</dt>
              <dd>
                <Commit sha={health.commit} testId="status-backend-commit" />
              </dd>
              <dt>Rewizja</dt>
              <dd data-testid="status-revision">{health.revision ?? '— (poza Azure)'}</dd>
              <dt>Replika</dt>
              <dd>{health.replica ?? '—'}</dd>
              <dt>Region</dt>
              <dd data-testid="status-region">{health.region ?? '—'}</dd>
              <dt>Działa od</dt>
              <dd title={formatDateTimeSeconds(health.startedAt)}>
                {formatUptime(health.startedAt, health.timestamp)}
              </dd>
            </Tile>

            <Tile title="Baza danych" ok={health.database === 'CONNECTED'} testId="status-database">
              <dt>Stan</dt>
              <dd data-testid="status-database-state">{health.database === 'CONNECTED' ? 'UP' : 'DOWN'}</dd>
              <dt>Czas odpowiedzi</dt>
              <dd data-testid="status-latency">{data.ms} ms</dd>
              <dt>Silnik</dt>
              <dd>PostgreSQL 16</dd>
            </Tile>

            <Tile title="Asystent AI" ok={health.assistant === 'ENABLED'} testId="status-assistant">
              <dt>Stan</dt>
              <dd>{health.assistant === 'ENABLED' ? 'włączony' : 'wyłączony'}</dd>
              <dt>Model</dt>
              <dd>Azure OpenAI</dd>
            </Tile>

            <Tile title="Koszty (FinOps)" ok testId="status-finops">
              <dt>Koszt – {FINOPS.month}</dt>
              <dd>{FINOPS.cost}</dd>
              <dt>Prognoza na cały miesiąc</dt>
              <dd>{FINOPS.forecast}</dd>
              <dt>Budżet</dt>
              <dd>{FINOPS.budget} / mies.</dd>
              <dt>Stan na</dt>
              <dd>{FINOPS.asOf}</dd>
            </Tile>
          </div>

          <p className="status-checked">Sprawdzono: {formatDateTimeSeconds(health.timestamp)}</p>
        </>
      )}
    </>
  )
}
