import { errorMessage } from '../api/client'

export function ErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="error-state" role="alert" data-testid="error-state">
      <p>{errorMessage(error)}</p>
      <button type="button" onClick={onRetry} data-testid="error-retry">
        Spróbuj ponownie
      </button>
    </div>
  )
}
