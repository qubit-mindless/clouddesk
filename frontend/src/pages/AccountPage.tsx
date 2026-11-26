import { useState, type FormEvent } from 'react'
import { changePassword } from '../api/auth'
import { ApiError, errorMessage, type FieldErrors } from '../api/client'
import { ROLE_LABEL } from '../api/labels'
import { useAuth } from '../hooks/useAuth'
import { useToast } from '../hooks/useToast'
import { charCount } from '../utils/text'

// Jak w backendzie (POST /api/auth/password): nowe hasło 12–128 znaków, inne niż obecne.
const NEW_MIN = 12
const NEW_MAX = 128

type Field = 'currentPassword' | 'newPassword' | 'repeat'

function validate(current: string, next: string, repeat: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!current) errors.currentPassword = 'Podaj obecne hasło.'
  if (charCount(next) < NEW_MIN) errors.newPassword = `Nowe hasło musi mieć co najmniej ${NEW_MIN} znaków.`
  else if (charCount(next) > NEW_MAX) errors.newPassword = `Nowe hasło może mieć najwyżej ${NEW_MAX} znaków.`
  else if (next === current) errors.newPassword = 'Nowe hasło musi być inne niż obecne.'
  if (!errors.newPassword && repeat !== next) errors.repeat = 'Hasła się różnią.'
  return errors
}

// „Moje konto”: dane z logowania i zmiana własnego hasła – np. po pierwszym logowaniu hasłem tymczasowym od administratora.
export function AccountPage() {
  const { user } = useAuth()
  const toast = useToast()
  const [values, setValues] = useState<Record<Field, string>>({ currentPassword: '', newPassword: '', repeat: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  if (!user) return null
  const set = (field: Field, value: string) => setValues((v) => ({ ...v, [field]: value }))

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    const found = validate(values.currentPassword, values.newPassword, values.repeat)
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      await changePassword(values.currentPassword, values.newPassword)
      setValues({ currentPassword: '', newPassword: '', repeat: '' })
      toast('Hasło zmienione. Przy następnym logowaniu użyj nowego.')
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors)
      else setFormError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const fieldProps = (field: Field) => ({
    id: `account-${field}`,
    type: 'password',
    value: values[field],
    onChange: (e: { target: { value: string } }) => set(field, e.target.value),
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `account-${field}-error` : undefined,
    'data-testid': `account-${field}`,
  })
  const fieldError = (field: Field) =>
    errors[field] && (
      <span className="field-error" id={`account-${field}-error`} data-testid={`account-${field}-error`}>
        {errors[field]}
      </span>
    )

  return (
    <section className="details" data-testid="account-page">
      <h2>Moje konto</h2>
      <dl>
        <dt>Imię i nazwisko</dt>
        <dd>{user.fullName}</dd>
        <dt>E-mail</dt>
        <dd>{user.email}</dd>
        <dt>Rola</dt>
        <dd>{ROLE_LABEL[user.role]}</dd>
      </dl>

      <h3>Zmiana hasła</h3>
      <p className="muted">Nowe hasło: co najmniej {NEW_MIN} znaków. Hasło tymczasowe od administratora zmień od razu po pierwszym logowaniu.</p>
      <form className="ticket-form" onSubmit={handleSubmit} noValidate data-testid="account-password-form">
        <label htmlFor="account-currentPassword">Obecne hasło</label>
        <input {...fieldProps('currentPassword')} autoComplete="current-password" />
        {fieldError('currentPassword')}
        <label htmlFor="account-newPassword">Nowe hasło</label>
        <input {...fieldProps('newPassword')} autoComplete="new-password" />
        {fieldError('newPassword')}
        <label htmlFor="account-repeat">Powtórz nowe hasło</label>
        <input {...fieldProps('repeat')} autoComplete="new-password" />
        {fieldError('repeat')}
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving} data-testid="account-password-submit">
            {saving ? 'Zapisywanie…' : 'Zmień hasło'}
          </button>
        </div>
      </form>
    </section>
  )
}
