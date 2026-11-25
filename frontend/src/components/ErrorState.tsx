import { useEffect } from 'react'
import { ApiError, errorMessage } from '../api/client'

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  // Błąd sieci (status 0): po powrocie połączenia ponawiamy sami, bez czekania na klik.
  const network = error instanceof ApiError && error.status === 0
  useEffect(() => {
    if (!network) return
    window.addEventListener('online', onRetry)
    return () => window.removeEventListener('online', onRetry)
  }, [network, onRetry])

  return (
    <div className="error-state" role="alert" data-testid="error-state">
      <p>{errorMessage(error)}</p>
      <button type="button" onClick={onRetry} data-testid="error-retry">
        Spróbuj ponownie
      </button>
    </div>
  )
}
