import { useCallback, useEffect, useEffectEvent, useState } from 'react'

interface RequestState<T> {
  data?: T
  error?: unknown
  loading: boolean
  reload: () => void
}

// Pobiera dane przy montowaniu i przy każdej zmianie `key`. Poprzednie żądanie jest przerywane,
// więc szybkie przełączanie filtrów nie nadpisze wyniku starszą odpowiedzią.
export function useRequest<T>(key: string, load: (signal: AbortSignal) => Promise<T>): RequestState<T> {
  const run = useEffectEvent(load)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; attempt: number; data?: T; error?: unknown }>()

  useEffect(() => {
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => setState({ key, attempt, data }),
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ key, attempt, error })
      },
    )
    return () => controller.abort()
  }, [key, attempt])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const current = state?.key === key && state.attempt === attempt ? state : undefined
  return { data: current?.data, error: current?.error, loading: !current, reload }
}
