import { useEffect, useRef } from 'react'
import { ApiError, errorMessage } from '../api/client'

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // Błąd sieci (status 0): po powrocie połączenia ponawiamy sami, bez czekania na klik.
  // Rodzice podają `onRetry` tworzone w renderze, więc trzymamy najnowsze w refie,
  // a nasłuch podpinamy tylko raz na wejście w stan błędu sieci.
  const network = error instanceof ApiError && error.status === 0
  const retryRef = useRef(onRetry)
  useEffect(() => {
    retryRef.current = onRetry
  })
  useEffect(() => {
    if (!network) return
    const handleOnline = () => retryRef.current()
    window.addEventListener('online', handleOnline)
    return () => window.removeEventListener('online', handleOnline)
  }, [network])

  return (
    <div className="error-state" role="alert" data-testid="error-state">
      <p>{errorMessage(error)}</p>
      <button type="button" onClick={onRetry} data-testid="error-retry">
        Spróbuj ponownie
      </button>
    </div>
  )
}
