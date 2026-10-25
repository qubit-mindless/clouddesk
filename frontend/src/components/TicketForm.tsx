import { useState, type FormEvent } from 'react'
import { ApiError, errorMessage, type FieldErrors } from '../api/client'
import { PRIORITY_LABEL, STATUS_LABEL } from '../api/labels'
import type { Ticket, TicketPriority, TicketStatus, TicketUpdate } from '../api/types'

// Te same reguły co w DTO z #13. Backend sprawdza je ponownie, a jego 422 trafia do tych samych pól.
const TITLE_MIN = 5
const TITLE_MAX = 200
const DESCRIPTION_MAX = 5000

export interface TicketFormValues {
  title: string
  description: string
  priority: TicketPriority | ''
  status: TicketStatus
  assignee: string
}

interface Props {
  // Bez `ticket` formularz tworzy nowe zgłoszenie, z nim edytuje istniejące.
  ticket?: Ticket
  submitLabel: string
  onSubmit: (data: TicketUpdate) => Promise<void>
  onCancel: () => void
}

function validate(values: TicketFormValues): FieldErrors {
  const errors: FieldErrors = {}
  const title = values.title.trim()
  if (title.length < TITLE_MIN) errors.title = `Tytuł musi mieć co najmniej ${TITLE_MIN} znaków.`
  else if (title.length > TITLE_MAX) errors.title = `Tytuł może mieć najwyżej ${TITLE_MAX} znaków.`
  if (!values.priority) errors.priority = 'Wybierz priorytet.'
  const description = values.description.trim()
  if (!description) errors.description = 'Opisz problem.'
  else if (description.length > DESCRIPTION_MAX) errors.description = `Opis może mieć najwyżej ${DESCRIPTION_MAX} znaków.`
  return errors
}

function toValues(ticket?: Ticket): TicketFormValues {
  return {
    title: ticket?.title ?? '',
    description: ticket?.description ?? '',
    priority: ticket?.priority ?? '',
    status: ticket?.status ?? 'NEW',
    assignee: ticket?.assignee ?? '',
  }
}

// Przy edycji wysyłamy tylko zmienione pola, żeby PATCH nie nadpisał cudzych zmian.
function toPayload(values: TicketFormValues, ticket?: Ticket): TicketUpdate {
  const payload: TicketUpdate = {
    title: values.title.trim(),
    description: values.description.trim(),
    priority: values.priority as TicketPriority,
  }
  if (!ticket) return payload

  const changes: TicketUpdate = { ...payload, status: values.status, assignee: values.assignee.trim() || null }
  return Object.fromEntries(
    Object.entries(changes).filter(([key, value]) => ticket[key as keyof Ticket] !== value),
  ) as TicketUpdate
}

export function TicketForm({ ticket, submitLabel, onSubmit, onCancel }: Props) {
  const [values, setValues] = useState(() => toValues(ticket))
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const set = <K extends keyof TicketFormValues>(field: K, value: TicketFormValues[K]) => {
    setValues((v) => ({ ...v, [field]: value }))
    setErrors((e) => ({ ...e, [field]: undefined }))
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const found = validate(values)
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length > 0) return

    setSubmitting(true)
    try {
      await onSubmit(toPayload(values, ticket))
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? error.fieldErrors : {}
      setErrors(fieldErrors)
      // Komunikat ogólny tylko wtedy, gdy błędu nie da się przypiąć do żadnego pola.
      if (Object.keys(fieldErrors).length === 0) setFormError(errorMessage(error))
    } finally {
      setSubmitting(false)
    }
  }

  const fieldProps = (field: keyof TicketFormValues) => ({
    id: `ticket-${field}`,
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `ticket-${field}-error` : undefined,
  })
  const fieldError = (field: keyof TicketFormValues) =>
    errors[field] && (
      <span className="field-error" id={`ticket-${field}-error`} data-testid={`ticket-form-${field}-error`}>
        {errors[field]}
      </span>
    )

  return (
    <form className="ticket-form" onSubmit={handleSubmit} noValidate data-testid="ticket-form">
      <label htmlFor="ticket-title">Tytuł *</label>
      <input
        {...fieldProps('title')}
        data-testid="ticket-form-title"
        value={values.title}
        onChange={(e) => set('title', e.target.value)}
      />
      {fieldError('title')}

      <label htmlFor="ticket-priority">Priorytet *</label>
      <select
        {...fieldProps('priority')}
        data-testid="ticket-form-priority"
        value={values.priority}
        onChange={(e) => set('priority', e.target.value as TicketFormValues['priority'])}
      >
        <option value="">Wybierz…</option>
        {Object.entries(PRIORITY_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {fieldError('priority')}

      {ticket && (
        <>
          <label htmlFor="ticket-status">Status</label>
          <select
            {...fieldProps('status')}
            data-testid="ticket-form-status"
            value={values.status}
            onChange={(e) => set('status', e.target.value as TicketStatus)}
          >
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          {fieldError('status')}

          <label htmlFor="ticket-assignee">Technik</label>
          <input
            {...fieldProps('assignee')}
            data-testid="ticket-form-assignee"
            placeholder="np. tech.jan"
            value={values.assignee}
            onChange={(e) => set('assignee', e.target.value)}
          />
          {fieldError('assignee')}
        </>
      )}

      <label htmlFor="ticket-description">Opis *</label>
      <textarea
        {...fieldProps('description')}
        data-testid="ticket-form-description"
        rows={6}
        value={values.description}
        onChange={(e) => set('description', e.target.value)}
      />
      {fieldError('description')}

      {formError && (
        <p className="form-error" role="alert" data-testid="ticket-form-error">
          {formError}
        </p>
      )}

      <div className="form-actions">
        <button type="submit" className="primary" disabled={submitting} data-testid="ticket-form-submit">
          {submitting ? 'Zapisywanie…' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={submitting} data-testid="ticket-form-cancel">
          Anuluj
        </button>
      </div>
    </form>
  )
}
