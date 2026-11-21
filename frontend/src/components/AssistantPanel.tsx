import { useState } from 'react'
import { askAssistant, getAssistant } from '../api/assistant'
import { errorMessage } from '../api/client'
import type { AssistantConversation } from '../api/types'
import { useRequest } from '../hooks/useRequest'
import { formatDateTime } from '../utils/sla'
import { ErrorState } from './ErrorState'
import { Loading } from './Loading'

const MAX_LENGTH = 1000

export function AssistantPanel({ ticketId }: { ticketId: number }) {
  const { data: loaded, error: loadError, loading, reload } = useRequest(String(ticketId), (signal) => getAssistant(ticketId, signal))
  const [updated, setUpdated] = useState<{ ticketId: number; value: AssistantConversation }>()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [validation, setValidation] = useState('')

  const conversation = updated?.ticketId === ticketId ? updated.value : loaded

  const send = async (message?: string) => {
    if (sending) return
    setSending(true)
    setError('')
    try {
      const value = await askAssistant(ticketId, message)
      setUpdated({ ticketId, value })
      if (message !== undefined) setText('')
    } catch (e) {
      // Wpisany tekst zostaje, żeby można było ponowić pytanie. Rozmowę i limit odświeżamy – ktoś inny
      // mógł w tym czasie dopisać pytanie albo wyczerpać limit (429).
      setError(errorMessage(e))
      setUpdated(undefined)
      reload()
    } finally {
      setSending(false)
    }
  }

  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = text.trim()
    if (!message) return setValidation('Wpisz pytanie.')
    if (message.length > MAX_LENGTH) return setValidation(`Pytanie może mieć najwyżej ${MAX_LENGTH} znaków.`)
    setValidation('')
    void send(message)
  }

  // Jak backend: liczy się tekst bez białych znaków na początku i końcu.
  const tooLong = text.trim().length > MAX_LENGTH
  const noQuota = conversation !== undefined && conversation.remaining <= 0

  return (
    <section className="assistant" aria-labelledby="assistant-heading" data-testid="assistant-panel">
      <h3 id="assistant-heading">Asystent AI</h3>
      {loading && <Loading label="Ładowanie asystenta…" />}
      {loadError !== undefined && <ErrorState error={loadError} onRetry={reload} />}
      {conversation && !conversation.enabled && (
        <p className="assistant-info" data-testid="assistant-disabled">
          Asystent AI nie jest skonfigurowany na tym serwerze.
        </p>
      )}
      {conversation?.enabled && (
        <>
          <div className="assistant-messages" aria-live="polite">
            {conversation.items.map((message) => (
              <div key={message.id} className={`assistant-message assistant-${message.role}`} data-testid="assistant-message" data-role={message.role}>
                <div className="assistant-meta">
                  {message.role === 'assistant' ? 'Asystent' : (message.author ?? 'Użytkownik')} · {formatDateTime(message.createdAt)}
                </div>
                <p>{message.content}</p>
              </div>
            ))}
            {sending && (
              <p className="loading" role="status" data-testid="assistant-loading">
                <span className="spinner" aria-hidden="true" />
                Asystent pisze odpowiedź…
              </p>
            )}
          </div>
          {conversation.items.length === 0 && (
            <div className="assistant-empty" data-testid="assistant-empty">
              <p>Asystent może zaproponować pierwsze rozwiązanie na podstawie opisu zgłoszenia.</p>
              <button type="button" onClick={() => void send()} disabled={sending || noQuota} data-testid="assistant-suggest">
                Zaproponuj rozwiązanie
              </button>
            </div>
          )}
          <p className="assistant-remaining" data-testid="assistant-remaining">
            Pozostało pytań: {conversation.remaining}
          </p>
          {error && (
            <p className="form-error" role="alert" data-testid="assistant-error">
              {error}
            </p>
          )}
          {!noQuota && (
            <form className="assistant-form" onSubmit={handleSubmit} noValidate>
              <label htmlFor="assistant-input">Zadaj pytanie asystentowi</label>
              <textarea
                id="assistant-input"
                rows={3}
                value={text}
                onChange={(e) => {
                  setText(e.target.value)
                  setValidation('')
                }}
                aria-invalid={tooLong || validation !== ''}
                data-testid="assistant-input"
              />
              <div className="assistant-form-footer">
                <span className={tooLong ? 'field-error' : 'assistant-counter'}>
                  {text.trim().length}/{MAX_LENGTH}
                </span>
                <button type="submit" className="primary" disabled={sending || tooLong} data-testid="assistant-send">
                  {sending ? 'Wysyłanie…' : 'Wyślij'}
                </button>
              </div>
              {validation && <p className="field-error">{validation}</p>}
            </form>
          )}
        </>
      )}
    </section>
  )
}
