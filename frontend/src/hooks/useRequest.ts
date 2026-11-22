import { useCallback, useEffect, useEffectEvent, useState } from 'react'

interface RequestState<T> {
  data?: T
  error?: unknown
  loading: boolean
  // Do którego `key` należą zwracane dane – przy keepData w trakcie ładowania mogą być jeszcze z poprzedniego.
  dataKey?: string
  // Kiedy przyszły zwracane dane (ms od epoki) – do napisu „odświeżono 5 s temu”.
  updatedAt?: number
  // Ostatnia próba dla tego `key` skończyła się błędem i od tamtej pory nic się nie udało
  // (zostaje także w trakcie kolejnej próby, więc wskaźnik nie miga przy każdym odpytaniu).
  failed: boolean
  reload: () => void
}

interface RequestOptions {
  // W trakcie ponownego pobierania zwraca ostatnie dane (loading = true), zamiast je czyścić – strona nie miga,
  // a przycisk „Odśwież” nie znika razem z fokusem. Dane z innego `key` pokazujemy tylko w trakcie ładowania:
  // gdy nowe żądanie się nie uda, strona dostaje błąd, a nie wyniki poprzedniego filtra.
  keepData?: boolean
  // Ponowne pobieranie co tyle ms (#141), liczone od zakończenia poprzedniego żądania – wolna odpowiedź
  // (np. backend budzący się ze skali zero) nie jest przerywana przez następną. Stoi przy ukrytej karcie:
  // każde żądanie budzi replikę, a po zamknięciu karty ma ona zejść do zera. Po powrocie na kartę od razu odświeża.
  intervalMs?: number
}

// Pobiera dane przy montowaniu i przy każdej zmianie `key`. Poprzednie żądanie jest przerywane,
// więc szybkie przełączanie filtrów nie nadpisze wyniku starszą odpowiedzią.
export function useRequest<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  { keepData = false, intervalMs }: RequestOptions = {},
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
  const settled = current !== undefined

  // Odpytywanie: kolejne żądanie dopiero po zakończeniu bieżącego (sukces albo błąd).
  useEffect(() => {
    if (!intervalMs || !settled) return
    let timer: number | undefined
    const tick = () => setAttempt((n) => n + 1)
    const onVisibility = () => {
      window.clearTimeout(timer)
      if (!document.hidden) tick()
    }

    if (!document.hidden) timer = window.setTimeout(tick, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, settled, key, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])

  let data: T | undefined
  let dataKey: string | undefined
  if (current?.data !== undefined) {
    data = current.data
    dataKey = key
  } else if (keepData && last && (last.key === key || (!current && failedKey !== key))) {
    // Ten sam widok: ostatnie dane także przy błędzie odświeżenia. Inny widok: tylko w trakcie pierwszego
    // ładowania – po błędzie tego widoku (także w trakcie ponownej próby) już nie, żeby nie udawać jego wyników.
    data = last.data
    dataKey = last.key
  }

  return {
    data,
    error: current?.error,
    loading: !current,
    dataKey,
    updatedAt: data !== undefined ? last?.at : undefined,
    failed: failedKey === key,
    reload,
  }
}
