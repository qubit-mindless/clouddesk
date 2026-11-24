import { useCallback, useEffect, useEffectEvent, useState } from 'react'

interface RequestState<T> {
  data?: T
  error?: unknown
  loading: boolean
  // Do którego `key` należą zwracane dane (zawsze do bieżącego, jeśli w ogóle są).
  dataKey?: string
  // Kiedy przyszły zwracane dane (ms od epoki) – do napisu „odświeżono 5 s temu”.
  updatedAt?: number
  // Ostatnia próba dla tego `key` skończyła się błędem i od tamtej pory nic się nie udało
  // (zostaje także w trakcie kolejnej próby, więc wskaźnik nie miga przy każdym odpytaniu).
  failed: boolean
  // Numer próby – pozwala odróżnić odświeżenie zlecone ręcznie od odpytywania w tle.
  attempt: number
  reload: () => void
}

interface RequestOptions {
  // W trakcie ponownego pobierania tego samego `key` zwraca ostatnie dane (loading = true), zamiast je czyścić –
  // strona nie miga, a przycisk „Odśwież” nie znika razem z fokusem. Dane innego `key` (np. poprzedni filtr)
  // nigdy nie są pokazywane pod nowym: zmiana klucza zaczyna od ładowania, a błąd to błąd, nie cudze wyniki.
  keepData?: boolean
  // Ponowne pobieranie co tyle ms (#141), liczone od zakończenia poprzedniego żądania – wolna odpowiedź
  // (np. backend budzący się ze skali zero) nie jest przerywana przez następną. Stoi przy ukrytej karcie:
  // każde żądanie budzi replikę, a po zamknięciu karty ma ona zejść do zera. Po powrocie na kartę odświeża od razu tylko
  // nieaktualne dane (starsze niż intervalMs) – szybkie przełączanie kart nie wysyła serii żądań.
  // Nie rusza, dopóki dla tego `key` nie ma żadnych danych – błąd pierwszego ładowania zostaje na ekranie
  // (z fokusem na „Spróbuj ponownie”) aż do ręcznej próby.
  intervalMs?: number
  // Ciche żądania boczne (np. liczniki nad listą) bez przycisku „Spróbuj ponownie”: odpytuj także wtedy, gdy pierwsze
  // ładowanie się nie udało – inaczej po błędzie przy wybudzaniu backendu zostałyby puste do przeładowania strony.
  pollWithoutData?: boolean
}

// Pobiera dane przy montowaniu i przy każdej zmianie `key`. Poprzednie żądanie jest przerywane,
// więc szybkie przełączanie filtrów nie nadpisze wyniku starszą odpowiedzią.
export function useRequest<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  { keepData = false, intervalMs, pollWithoutData = false }: RequestOptions = {},
): RequestState<T> {
  const run = useEffectEvent(load)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; attempt: number; data?: T; error?: unknown }>()
  const [last, setLast] = useState<{ key: string; data: T; at: number }>()
  const [failedKey, setFailedKey] = useState<string>()

  useEffect(() => {
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => {
        // Odpowiedź, która doszła już po przerwaniu (np. szybkie 90 → 7 dni), nie może trafić do `last`.
        if (controller.signal.aborted) return
        setState({ key, attempt, data })
        setLast({ key, data, at: Date.now() })
        setFailedKey(undefined)
      },
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({ key, attempt, error })
        setFailedKey(key)
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const current = state?.key === key && state.attempt === attempt ? state : undefined
  // Z keepData ostatnie dane tego samego widoku zostają także przy błędzie odświeżenia – strona pokazuje je obok błędu.
  const data = current?.data !== undefined ? current.data : keepData && last?.key === key ? last.data : undefined
  const canPoll = Boolean(intervalMs) && current !== undefined && (data !== undefined || pollWithoutData)
  const lastAt = last?.key === key ? last.at : undefined

  // Odpytywanie: kolejne żądanie dopiero po zakończeniu bieżącego (sukces albo błąd odświeżenia).
  useEffect(() => {
    if (!intervalMs || !canPoll) return
    let timer: number | undefined
    const tick = () => setAttempt((n) => n + 1)
    // Po powrocie na kartę: dane starsze niż intervalMs – od razu, świeższe – w zwykłym rytmie.
    const schedule = () => {
      const age = lastAt === undefined ? intervalMs : Date.now() - lastAt
      timer = window.setTimeout(tick, Math.max(0, intervalMs - age))
    }
    const onVisibility = () => {
      window.clearTimeout(timer)
      if (!document.hidden) schedule()
    }

    if (!document.hidden) timer = window.setTimeout(tick, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, canPoll, key, attempt, lastAt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  return {
    data,
    error: current?.error,
    loading: !current,
    dataKey: data !== undefined ? key : undefined,
    updatedAt: data !== undefined ? last?.at : undefined,
    failed: failedKey === key,
    attempt,
    reload,
  }
}
