import { useCallback, useEffect, useEffectEvent, useState } from 'react'

interface RequestState<T> {
  data?: T
  error?: unknown
  loading: boolean
  reload: () => void
}

// Pobiera dane przy montowaniu i przy każdej zmianie `key`. Poprzednie żądanie jest przerywane,
// więc szybkie przełączanie filtrów nie nadpisze wyniku starszą odpowiedzią.
// `keepData`: w trakcie ponownego pobierania zwraca ostatnie dane (loading = true), zamiast je czyścić –
// strona nie miga, a przycisk „Odśwież” nie znika razem z fokusem.
export function useRequest<T>(
  key: string,
  load: (signal: AbortSignal) => Promise<T>,
  { keepData = false }: { keepData?: boolean } = {},
): RequestState<T> {
  const run = useEffectEvent(load)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; attempt: number; data?: T; error?: unknown }>()
  const [lastData, setLastData] = useState<T>()

  useEffect(() => {
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => {
        setState({ key, attempt, data })
        setLastData(data)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key, attempt, error })
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const current = state?.key === key && state.attempt === attempt ? state : undefined
  const data = current ? current.data : keepData ? lastData : undefined
  return { data, error: current?.error, loading: !current, reload }
}
