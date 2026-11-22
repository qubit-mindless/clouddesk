import { useNow } from '../hooks/useNow'

// „● Na żywo · odświeżono 12 s temu” (#141). Własny timer co 5 s, więc tykanie nie przerysowuje tabeli.
// Bez aria-live – czytnik ekranu nie powinien co chwilę odczytywać zmieniającej się liczby sekund.
// `busy`: trwa odświeżenie zlecone przez użytkownika („Odśwież”) – wtedy pokazujemy to wprost.
export function LiveStatus({ updatedAt, failed, busy = false }: { updatedAt?: number; failed: boolean; busy?: boolean }) {
  const now = useNow(5_000)
  if (updatedAt === undefined) return null

  const seconds = Math.max(0, Math.round((now - updatedAt) / 1000))
  const ago = seconds < 60 ? `${seconds} s temu` : `${Math.floor(seconds / 60)} min temu`

  return (
    <span className={`live-status ${failed ? 'live-failed' : ''}`} data-testid="live-status">
      <span className="live-dot" aria-hidden="true" />
      {busy ? 'Odświeżanie…' : failed ? `Nie udało się odświeżyć · dane sprzed ${ago.replace(' temu', '')}` : `Na żywo · odświeżono ${ago}`}
    </span>
  )
}
