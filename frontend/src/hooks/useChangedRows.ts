import { useEffect, useRef, useState } from 'react'
import type { Ticket } from '../api/types'

const FLASH_MS = 2500

// Po odświeżeniu listy w tle (#141): które wiersze się zmieniły (nowe albo z innym `updatedAt`) i ile przybyło
// nowych zgłoszeń. Porównujemy tylko kolejne świeże odpowiedzi dla tego samego widoku (`dataKey` z useRequest) –
// zmiana filtra to nowy punkt odniesienia, a nie „zmienione” wiersze. Podświetlenie gaśnie po FLASH_MS.
// `fresh`: dane pochodzą z właśnie zakończonego, udanego żądania (nie są pokazywane zastępczo w trakcie ładowania).
export function useChangedRows(tickets: Ticket[] | undefined, dataKey: string | undefined, fresh: boolean) {
  const baseline = useRef<{ key: string; versions: Map<number, string> }>(undefined)
  // Timer gaszenia w refie: zmiana filtra czy kolejne odświeżenie nie może go anulować i zostawić podświetlenia.
  const clearTimer = useRef<number>(undefined)
  const [flash, setFlash] = useState<{ key: string; ids: Set<number>; added: number }>()

  useEffect(() => () => window.clearTimeout(clearTimer.current), [])

  useEffect(() => {
    if (!tickets || !fresh || dataKey === undefined) return
    const before = baseline.current
    baseline.current = { key: dataKey, versions: new Map(tickets.map((t) => [t.id, t.updatedAt])) }
    if (!before || before.key !== dataKey) return

    const ids = new Set(tickets.filter((t) => before.versions.get(t.id) !== t.updatedAt).map((t) => t.id))
    if (ids.size === 0) return
    const added = tickets.filter((t) => !before.versions.has(t.id)).length
    setFlash({ key: dataKey, ids, added })
    window.clearTimeout(clearTimer.current)
    clearTimer.current = window.setTimeout(() => setFlash(undefined), FLASH_MS)
  }, [tickets, dataKey, fresh])

  // Podświetlenie należy do widoku, w którym powstało – po zmianie filtra od razu znika.
  return flash?.key === dataKey ? flash : undefined
}
