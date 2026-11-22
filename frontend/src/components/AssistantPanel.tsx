import { useEffect, useRef, useState } from 'react'
import { askAssistant, getAssistant } from '../api/assistant'
import { errorMessage } from '../api/client'
import { resolveTicket } from '../api/tickets'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import type { AssistantConversation, AssistantMessage, Ticket } from '../api/types'
import { useRequest } from '../hooks/useRequest'
import { formatDateTime } from '../utils/sla'
import { ErrorState } from './ErrorState'
import { Loading } from './Loading'

const MAX_LENGTH = 1000

// Z asystentem rozmawia osoba zgłaszająca (pierwsza linia pomocy, zanim albo gdy technik zajmuje się zgłoszeniem).
// Technik i administrator widzą tę rozmowę tylko do odczytu – wiedzą, co zgłaszający już sprawdził.
interface Props {
  ticketId: number
  reporter: string
  // Tuż po utworzeniu zgłoszenia asystent od razu proponuje kroki – bez klikania „Podpowiedz”.
  autoSuggest?: boolean
  // Zgłaszający zamknął zgłoszenie przyciskiem „Pomogło” – strona odświeża zgłoszenie.
  onResolved?: (ticket: Ticket) => void
}

export function AssistantPanel({ ticketId, reporter, autoSuggest = false, onResolved }: Props) {
  const { data: loaded, error: loadError, loading, reload } = useRequest(String(ticketId), (signal) => getAssistant(ticketId, signal))
  const [updated, setUpdated] = useState<{ ticketId: number; value: AssistantConversation }>()
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  // Błąd zapamiętany razem ze zgłoszeniem – po przejściu do innego zgłoszenia nie jest już pokazywany.
  const [failure, setFailure] = useState<{ ticketId: number; message: string }>()
  const [validation, setValidation] = useState('')
  const toast = useToast()
  const { user } = useAuth()
  const [resolving, setResolving] = useState(false)
  // „Nie pomogło” chowa pytanie dla tego zgłoszenia; technik i tak dostaje zgłoszenie razem z rozmową.
  const [handedOver, setHandedOver] = useState<number>()
  const suggested = useRef<number>(undefined)

  const conversation = updated?.ticketId === ticketId ? updated.value : loaded
  const error = failure?.ticketId === ticketId ? failure.message : ''
  const staffView = conversation?.readOnlyReason === 'not_reporter'

  const send = async (message?: string) => {
    if (sending) return
    setSending(true)
    setFailure(undefined)
    try {
      const value = await askAssistant(ticketId, message)
      setUpdated({ ticketId, value })
      if (message !== undefined) setText('')
    } catch (e) {
      // Wpisany tekst zostaje, żeby można było ponowić pytanie. Rozmowę i limit odświeżamy – w tym czasie
      // mogła dojść inna odpowiedź albo zmienić się status zgłoszenia (409/429).
      setFailure({ ticketId, message: errorMessage(e) })
      setUpdated(undefined)
      reload()
    } finally {
      setSending(false)
    }
  }

  const conversationReady = conversation !== undefined
  useEffect(() => {
    if (!autoSuggest || !conversation || suggested.current === ticketId) return
    if (!conversation.canAsk || !conversation.enabled || conversation.items.length > 0) return
    suggested.current = ticketId
    void send()
    // send zmienia się przy każdym renderze; wystarczy jedno wywołanie po wczytaniu rozmowy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSuggest, conversationReady, ticketId])

  const resolve = async () => {
    setResolving(true)
    try {
      const ticket = await resolveTicket(ticketId)
      toast('Zgłoszenie zamknięte – dziękujemy! Problem rozwiązany bez czekania na technika.')
      setUpdated(undefined)
      reload()
      onResolved?.(ticket)
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setResolving(false)
    }
  }
  const hasAnswer = conversation?.items.some((m) => m.role === 'assistant') ?? false
  // Zamknąć „po pomocy AI” może tylko zgłaszający (technik i admin zamykają przez status – backend daje im 403).
  const askHelped = user?.role === 'REPORTER' && conversation?.canAsk && hasAnswer && !sending && handedOver !== ticketId

  const handleSubmit = (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault()
    const message = text.trim()
    if (!message) return setValidation('Napisz, z czym potrzebujesz pomocy.')
    if (message.length > MAX_LENGTH) return setValidation(`Wiadomość może mieć najwyżej ${MAX_LENGTH} znaków.`)
    setValidation('')
    void send(message)
  }

  // Jak backend: liczy się tekst bez białych znaków na początku i końcu.
  const tooLong = text.trim().length > MAX_LENGTH
  const noQuota = conversation !== undefined && conversation.remaining <= 0

  // Starsze rozmowy mogą mieć pytania technika (przed zmianą pisać mógł każdy) – podpisujemy je jego loginem.
  // Wiadomości bez autora (dane demo sprzed zapisywania autora) traktujemy jak wiadomości zgłaszającego.
  const authorLabel = (message: AssistantMessage) => {
    if (message.role === 'assistant') return 'Asystent AI'
    if (message.author !== null && message.author !== reporter) return message.author
    return staffView ? `Zgłaszający (${reporter})` : 'Ty'
  }

  return (
    <section className="assistant" aria-labelledby="assistant-heading" data-testid="assistant-panel">
      <h3 id="assistant-heading">{staffView ? 'Rozmowa zgłaszającego z asystentem AI' : 'Pomoc asystenta AI'}</h3>
      {loading && <Loading label="Ładowanie asystenta…" />}
      {loadError !== undefined && <ErrorState error={loadError} onRetry={reload} />}
      {/* Poza blokiem rozmowy: po błędzie rozmowa się przeładowuje, a komunikat ma zostać widoczny. */}
      {error && (
        <p className="form-error" role="alert" data-testid="assistant-error">
          {error}
        </p>
      )}

      {conversation && staffView && (
        <p className="assistant-info" data-testid="assistant-readonly">
          {conversation.items.length === 0
            ? 'Zgłaszający nie rozmawiał z asystentem AI.'
            : 'Tylko do odczytu – o co zgłaszający pytał asystenta AI i jakie wskazówki padły w rozmowie.'}
        </p>
      )}
      {conversation && !staffView && !conversation.enabled && (
        <p className="assistant-info" data-testid="assistant-disabled">
          Asystent AI nie jest skonfigurowany na tym serwerze.
        </p>
      )}
      {conversation && conversation.readOnlyReason === 'resolved' && (
        <p className="assistant-info" data-testid="assistant-closed">
          Zgłoszenie jest rozwiązane – rozmowa z asystentem AI jest zamknięta.
        </p>
      )}

      {conversation && (
        <>
          {/* Region aria-live zawsze w drzewie (czytnik ekranu ogłosi pierwszą odpowiedź); historia widoczna
              także wtedy, gdy asystent jest wyłączony. */}
          <div className="assistant-messages" aria-live="polite">
            {conversation.items.map((message) => (
              <div key={message.id} className={`assistant-message assistant-${message.role}`} data-testid="assistant-message" data-role={message.role}>
                <div className="assistant-meta">
                  {authorLabel(message)} · {formatDateTime(message.createdAt)}
                </div>
                <p>{message.content}</p>
              </div>
            ))}
          </div>
          {conversation.canAsk && conversation.enabled && (
            <>
              {conversation.items.length === 0 && (
                <div className="assistant-empty" data-testid="assistant-empty">
                  <p>
                    Zanim technik zajmie się Twoim zgłoszeniem, asystent AI może podpowiedzieć, co sprawdzić samodzielnie – często
                    to wystarcza. Technik zobaczy tę rozmowę, więc nie trzeba mu powtarzać, co już zostało sprawdzone.
                  </p>
                  <button type="button" onClick={() => void send()} disabled={sending || noQuota} data-testid="assistant-suggest">
                    Podpowiedz, co mogę sprawdzić
                  </button>
                </div>
              )}
              {sending && (
                <p className="loading" role="status" data-testid="assistant-loading">
                  <span className="spinner" aria-hidden="true" />
                  Asystent pisze odpowiedź…
                </p>
              )}
              {askHelped && (
                <div className="assistant-helped" data-testid="assistant-helped">
                  <p>Czy to rozwiązało problem?</p>
                  <div className="assistant-helped-actions">
                    <button type="button" className="primary" onClick={() => void resolve()} disabled={resolving} data-testid="assistant-resolve">
                      {resolving ? 'Zamykanie…' : '✓ Pomogło – zamknij zgłoszenie'}
                    </button>
                    <button type="button" onClick={() => setHandedOver(ticketId)} data-testid="assistant-handover">
                      Nie pomogło – czekam na technika
                    </button>
                  </div>
                </div>
              )}
              {handedOver === ticketId && (
                <p className="assistant-info" role="status" data-testid="assistant-handed-over">
                  Technik dostanie zgłoszenie razem z tą rozmową – nie musisz niczego powtarzać.
                </p>
              )}
              <p className="assistant-remaining" data-testid="assistant-remaining">
                Pozostało wiadomości do asystenta: {conversation.remaining}
              </p>
              {!noQuota && (
                <form className="assistant-form" onSubmit={handleSubmit} noValidate>
                  <label htmlFor="assistant-input">
                    {conversation.items.length === 0 ? 'Albo opisz własnymi słowami, z czym masz problem' : 'Napisz do asystenta (np. co się stało po wykonaniu kroków)'}
                  </label>
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
              {noQuota && (
                <p className="assistant-info" data-testid="assistant-no-quota">
                  Wykorzystano limit wiadomości do asystenta – technik odpowie w zgłoszeniu.
                </p>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
