import { useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { ApiError, errorMessage, type FieldErrors } from '../api/client'
import type { ReturnTo } from '../auth/RequireAuth'
import { Loading } from '../components/Loading'
import { DEMO_ACCOUNTS } from '../config'
import { useAuth } from '../hooks/useAuth'
import { charCount } from '../utils/text'

// Te same limity co LoginRequest w backendzie (#106); backend i tak sprawdza je ponownie.
const EMAIL_MAX = 255
const PASSWORD_MAX = 128
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!email) errors.email = 'Podaj adres e-mail.'
  else if (charCount(email) > EMAIL_MAX || !EMAIL_PATTERN.test(email)) errors.email = 'Podaj poprawny adres e-mail.'
  if (!password) errors.password = 'Podaj hasło.'
  else if (charCount(password) > PASSWORD_MAX) errors.password = `Hasło może mieć najwyżej ${PASSWORD_MAX} znaków.`
  return errors
}

// Dokąd wrócić po zalogowaniu: tylko ścieżki wewnątrz aplikacji (bez otwartego przekierowania).
function returnTo(state: unknown): ReturnTo {
  const from = (state as { from?: Partial<ReturnTo> } | null)?.from
  const path = from?.path
  const safe = typeof path === 'string' && path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/login')
  return safe ? { path, state: from?.state } : { path: '/tickets', state: undefined }
}

export function LoginPage() {
  const { status, endReason, login } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Blokada synchroniczna: dwa szybkie Entery przed ponownym renderem nie wyślą logowania dwa razy.
  const inFlight = useRef(false)
  const passwordRef = useRef<HTMLInputElement>(null)

  const target = returnTo(state)
  if (status === 'authenticated' && !submitting) return <Navigate to={target.path} state={target.state} replace />
  // Sprawdzanie zapisanej sesji: bez tego formularz mignąłby przed przekierowaniem zalogowanego użytkownika.
  if (status === 'checking') return <Loading label="Sprawdzanie sesji…" />

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (inFlight.current) return
    const trimmedEmail = email.trim()
    const found = validate(trimmedEmail, password)
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length > 0) return

    inFlight.current = true
    setSubmitting(true)
    try {
      await login(trimmedEmail, password)
      navigate(target.path, { state: target.state, replace: true })
    } catch (error) {
      const fieldErrors = error instanceof ApiError ? error.fieldErrors : {}
      setErrors(fieldErrors)
      // 401 przychodzi z jednym komunikatem dla złego hasła i nieznanego e-maila – pokazujemy go nad przyciskiem.
      if (Object.keys(fieldErrors).length === 0) setFormError(errorMessage(error))
      setPassword('')
      inFlight.current = false
      setSubmitting(false)
    }
  }

  const fieldProps = (field: 'email' | 'password') => ({
    id: `login-${field}`,
    'data-testid': `login-${field}`,
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `login-${field}-error` : undefined,
  })
  const fieldError = (field: 'email' | 'password') =>
    errors[field] && (
      <span className="field-error" id={`login-${field}-error`} data-testid={`login-${field}-error`}>
        {errors[field]}
      </span>
    )

  return (
    <section className="login-card" aria-labelledby="login-heading">
      <div className="login-brand">
        <h2 id="login-heading">CloudDesk</h2>
        <p>System zgłoszeń IT z SLA i asystentem AI</p>
      </div>
      {endReason === 'expired' && (
        <p className="form-error" role="status" data-testid="login-expired">
          Sesja wygasła. Zaloguj się ponownie.
        </p>
      )}
      <form className="ticket-form" onSubmit={handleSubmit} noValidate data-testid="login-form">
        <label htmlFor="login-email">E-mail</label>
        <input
          {...fieldProps('email')}
          type="email"
          autoComplete="username"
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            setErrors((v) => ({ ...v, email: undefined }))
          }}
        />
        {fieldError('email')}

        <label htmlFor="login-password">Hasło</label>
        <input
          {...fieldProps('password')}
          ref={passwordRef}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            setErrors((v) => ({ ...v, password: undefined }))
          }}
        />
        {fieldError('password')}

        {formError && (
          <p className="form-error" role="alert" data-testid="login-error">
            {formError}
          </p>
        )}

        <div className="form-actions">
          <button type="submit" className="primary login-submit" disabled={submitting} data-testid="login-submit">
            {submitting ? 'Logowanie…' : 'Zaloguj się'}
          </button>
        </div>
      </form>
      {DEMO_ACCOUNTS.length > 0 && (
        // Konta demo z seeda: przycisk tylko wpisuje e-mail – hasło trzeba podać (bez logowania „jednym kliknięciem”
        // na publicznym adresie, gdzie każdy mógłby działać jako technik).
        <div className="demo-accounts" data-testid="demo-accounts">
          <p className="divider">Konta demo</p>
          {DEMO_ACCOUNTS.map((account) => (
            <button
              key={account.email}
              type="button"
              className="demo-account"
              onClick={() => {
                setEmail(account.email)
                setErrors({})
                passwordRef.current?.focus()
              }}
            >
              {account.name} <small>{account.role}</small>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
