import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router'
import { ApiError, errorMessage, type FieldErrors } from '../api/client'
import { ROLE_LABEL } from '../api/labels'
import type { User, UserAdmin, UserRole } from '../api/types'
import { createUser, getUsers, resetPassword, updateUser } from '../api/users'
import { isAdmin } from '../auth/permissions'
import { ErrorState } from '../components/ErrorState'
import { Loading } from '../components/Loading'
import { useAuth } from '../hooks/useAuth'
import { useDebounced } from '../hooks/useDebounced'
import { useRequest } from '../hooks/useRequest'
import { useToast } from '../hooks/useToast'
import { charCount } from '../utils/text'
import { formatDateTime } from '../utils/time'

const ROLES = Object.keys(ROLE_LABEL) as UserRole[]
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NAME_MIN = 2
const NAME_MAX = 200

// Panel „Użytkownicy” (konta) – tylko administrator; backend i tak odpowie 403 każdej innej roli.
export function UsersPage() {
  const { user } = useAuth()
  return user && isAdmin(user) ? <UsersContent me={user} /> : <Navigate to="/tickets" replace />
}

// Hasło tymczasowe z odpowiedzi serwera: pokazujemy je tylko raz, w tej chwili – po przeładowaniu strony już go nie ma.
interface Secret {
  login: string
  password: string
  reason: 'created' | 'reset'
}

// Akcja w wierszu, która wymaga potwierdzenia drugim kliknięciem (blokada konta, reset hasła).
interface Pending {
  id: number
  action: 'block' | 'reset'
}

function UsersContent({ me }: { me: User }) {
  const toast = useToast()
  const { refreshUser } = useAuth()
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<UserRole | ''>('')
  const q = useDebounced(query.trim(), 300)
  const { data, error, loading, reload } = useRequest(`${q}|${role}`, (signal) => getUsers({ q: q || undefined, role: role || undefined }, signal), {
    keepData: true,
  })

  const [creating, setCreating] = useState(false)
  const [secret, setSecret] = useState<Secret | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const run = async (id: number, action: () => Promise<void>) => {
    setBusyId(id)
    try {
      await action()
      reload()
    } catch (e) {
      toast(errorMessage(e), 'error')
    } finally {
      setBusyId(null)
      setPending(null)
    }
  }

  const toggleActive = (u: UserAdmin) =>
    run(u.id, async () => {
      await updateUser(u.id, { isActive: !u.isActive })
      toast(u.isActive ? `Zablokowano konto ${u.login}.` : `Odblokowano konto ${u.login}.`)
    })

  const reset = (u: UserAdmin) =>
    run(u.id, async () => {
      const { temporaryPassword } = await resetPassword(u.id)
      setSecret({ login: u.login, password: temporaryPassword, reason: 'reset' })
    })

  return (
    <>
      <div className="page-actions">
        <h2>Użytkownicy</h2>
        {!creating && (
          <button type="button" className="primary" onClick={() => setCreating(true)} data-testid="users-new">
            + Nowe konto
          </button>
        )}
      </div>

      {/* key: nowe hasło = nowy panel (stan „Skopiowano” nie przechodzi na kolejne hasło). */}
      {secret && <SecretPanel key={secret.password} secret={secret} onClose={() => setSecret(null)} />}

      {creating && (
        <NewUserForm
          onCancel={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false)
            setSecret({ login: created.user.login, password: created.temporaryPassword, reason: 'created' })
            toast(`Założono konto ${created.user.login}.`)
            reload()
          }}
        />
      )}

      <div className="filters" role="search">
        <label className="filters-search">
          Szukaj
          <input
            type="search"
            placeholder="Imię, nazwisko lub e-mail"
            maxLength={200}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="users-search"
          />
        </label>
        <label>
          Rola
          <select value={role} onChange={(e) => setRole(e.target.value as UserRole | '')} data-testid="users-filter-role">
            <option value="">Wszystkie</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && !data && <Loading label="Ładowanie kont…" />}
      {error !== undefined && !data && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && (
        <p className="empty" data-testid="users-empty">
          Brak kont pasujących do wyszukiwania.
        </p>
      )}
      {data && data.items.length > 0 && (
        <div className="table-wrap">
          <table className="users-table" data-testid="users-list">
            <thead>
              <tr>
                <th>Osoba</th>
                <th>Rola</th>
                <th>Stan</th>
                <th>Założone</th>
                <th>
                  <span className="visually-hidden">Akcje</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((u) =>
                editingId === u.id ? (
                  <EditRow
                    key={u.id}
                    user={u}
                    isSelf={u.id === me.id}
                    onCancel={() => setEditingId(null)}
                    onSaved={() => {
                      setEditingId(null)
                      toast(`Zapisano zmiany konta ${u.login}.`)
                      reload()
                      // Własne konto: nowe imię i nazwisko od razu w nagłówku i w „Moje konto”.
                      if (u.id === me.id) refreshUser()
                    }}
                  />
                ) : (
                  <tr key={u.id} className={u.isActive ? undefined : 'user-blocked'} data-testid={`user-row-${u.login}`}>
                    <td className="user-cell">
                      <strong>{u.fullName}</strong>
                      {u.id === me.id && <span className="muted"> (Ty)</span>}
                      <span className="row-sub">{u.email}</span>
                    </td>
                    <td>
                      <span className={`badge role-${u.role.toLowerCase()}`}>{ROLE_LABEL[u.role]}</span>
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? 'user-active' : 'user-inactive'}`} data-testid={`user-state-${u.login}`}>
                        {u.isActive ? 'Aktywne' : 'Zablokowane'}
                      </span>
                    </td>
                    <td className="muted">{formatDateTime(u.createdAt)}</td>
                    <td>
                      <div className="user-actions">
                      {pending?.id === u.id ? (
                        <>
                          <span className="muted">{pending.action === 'block' ? 'Zablokować konto?' : 'Nadać nowe hasło? Stare przestanie działać.'}</span>
                          <button
                            type="button"
                            className="danger-button"
                            disabled={busyId === u.id}
                            onClick={() => (pending.action === 'block' ? toggleActive(u) : reset(u))}
                            data-testid={`user-confirm-${u.login}`}
                          >
                            {pending.action === 'block' ? 'Zablokuj' : 'Nadaj nowe hasło'}
                          </button>
                          <button type="button" onClick={() => setPending(null)}>
                            Anuluj
                          </button>
                        </>
                      ) : (
                        <>
                          <button type="button" onClick={() => setEditingId(u.id)} disabled={busyId !== null} data-testid={`user-edit-${u.login}`}>
                            Edytuj
                          </button>
                          {u.isActive ? (
                            <button
                              type="button"
                              onClick={() => setPending({ id: u.id, action: 'block' })}
                              disabled={busyId !== null || u.id === me.id}
                              title={u.id === me.id ? 'Nie możesz zablokować własnego konta.' : undefined}
                              data-testid={`user-block-${u.login}`}
                            >
                              Zablokuj
                            </button>
                          ) : (
                            <button type="button" onClick={() => toggleActive(u)} disabled={busyId !== null} data-testid={`user-unblock-${u.login}`}>
                              Odblokuj
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setPending({ id: u.id, action: 'reset' })}
                            disabled={busyId !== null}
                            data-testid={`user-reset-${u.login}`}
                          >
                            Reset hasła
                          </button>
                        </>
                      )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      {data && data.total > data.items.length && (
        <p className="muted">
          Pokazano {data.items.length} z {data.total} – zawęź wyszukiwaniem.
        </p>
      )}
    </>
  )
}

function SecretPanel({ secret, onClose }: { secret: Secret; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(secret.password)
      setCopied(true)
    } catch {
      // Schowek niedostępny (np. stara przeglądarka) – hasło da się zaznaczyć i skopiować ręcznie.
      setCopied(false)
    }
  }
  return (
    <section className="secret-panel" role="status" aria-live="polite" data-testid="users-secret">
      <p>
        <strong>{secret.reason === 'created' ? 'Konto założone.' : 'Nowe hasło nadane.'}</strong> Hasło tymczasowe dla <code>{secret.login}</code>:
      </p>
      <div className="secret-row">
        <code className="secret-value" data-testid="users-secret-password">
          {secret.password}
        </code>
        <button type="button" onClick={() => void copy()} data-testid="users-secret-copy">
          {copied ? 'Skopiowano' : 'Kopiuj'}
        </button>
      </div>
      <p className="muted">
        Pokazujemy je tylko teraz – przekaż je tej osobie osobnym kanałem. Po pierwszym logowaniu niech zmieni hasło w „Moje konto” (kliknięcie
        imienia i nazwiska w nagłówku). Nowe hasło nie wylogowuje już otwartych sesji (działają do godziny) – żeby odciąć dostęp od razu,
        zablokuj konto.
      </p>
      <button type="button" onClick={onClose} data-testid="users-secret-close">
        Gotowe
      </button>
    </section>
  )
}

function NewUserForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: Awaited<ReturnType<typeof createUser>>) => void }) {
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [role, setRole] = useState<UserRole>('REPORTER')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const found: FieldErrors = {}
    if (!EMAIL_PATTERN.test(email.trim())) found.email = 'Podaj poprawny adres e-mail.'
    const name = fullName.trim()
    if (charCount(name) < NAME_MIN) found.fullName = 'Podaj imię i nazwisko.'
    else if (charCount(name) > NAME_MAX) found.fullName = `Najwyżej ${NAME_MAX} znaków.`
    setErrors(found)
    setFormError('')
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      onCreated(await createUser({ email: email.trim(), fullName: name, role }))
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) setErrors({ email: e.message })
      else if (e instanceof ApiError && Object.keys(e.fieldErrors).length) setErrors(e.fieldErrors)
      else setFormError(errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="details" data-testid="users-new-form">
      <h3>Nowe konto</h3>
      <p className="muted">Hasło tymczasowe wygeneruje system – zobaczysz je raz, po zapisaniu.</p>
      <form className="ticket-form" onSubmit={submit} noValidate>
        <label htmlFor="new-user-email">E-mail</label>
        <input
          id="new-user-email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? 'new-user-email-error' : undefined}
          data-testid="new-user-email"
        />
        {errors.email && (
          <span className="field-error" id="new-user-email-error">
            {errors.email}
          </span>
        )}
        <label htmlFor="new-user-fullName">Imię i nazwisko</label>
        <input
          id="new-user-fullName"
          autoComplete="off"
          maxLength={NAME_MAX}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? 'new-user-fullName-error' : undefined}
          data-testid="new-user-fullName"
        />
        {errors.fullName && (
          <span className="field-error" id="new-user-fullName-error">
            {errors.fullName}
          </span>
        )}
        <label htmlFor="new-user-role">Rola</label>
        <select id="new-user-role" value={role} onChange={(e) => setRole(e.target.value as UserRole)} data-testid="new-user-role">
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="primary" disabled={saving} data-testid="new-user-submit">
            {saving ? 'Zakładanie…' : 'Załóż konto'}
          </button>
          <button type="button" onClick={onCancel}>
            Anuluj
          </button>
        </div>
      </form>
    </section>
  )
}

function EditRow({ user, isSelf, onCancel, onSaved }: { user: UserAdmin; isSelf: boolean; onCancel: () => void; onSaved: () => void }) {
  const [fullName, setFullName] = useState(user.fullName)
  const [role, setRole] = useState<UserRole>(user.role)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const name = fullName.trim()
    if (charCount(name) < NAME_MIN) return setError('Podaj imię i nazwisko.')
    const changes = { ...(name !== user.fullName ? { fullName: name } : {}), ...(role !== user.role ? { role } : {}) }
    if (!Object.keys(changes).length) return onCancel()
    setSaving(true)
    setError('')
    try {
      await updateUser(user.id, changes)
      onSaved()
    } catch (e) {
      // Błąd pola z backendu (np. 422 przy fullName) – konkretny komunikat zamiast ogólnego „Popraw zaznaczone pola”.
      setError((e instanceof ApiError && (e.fieldErrors.fullName ?? e.fieldErrors.role)) || errorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr className="user-editing" data-testid={`user-edit-row-${user.login}`}>
      <td className="user-cell">
        <label className="visually-hidden" htmlFor={`edit-name-${user.id}`}>
          Imię i nazwisko
        </label>
        <input id={`edit-name-${user.id}`} value={fullName} maxLength={NAME_MAX} onChange={(e) => setFullName(e.target.value)} data-testid="edit-user-fullName" />
        <span className="row-sub">{user.email}</span>
        {error && (
          <span className="field-error" role="alert">
            {error}
          </span>
        )}
      </td>
      <td>
        <label className="visually-hidden" htmlFor={`edit-role-${user.id}`}>
          Rola
        </label>
        <select
          id={`edit-role-${user.id}`}
          value={role}
          disabled={isSelf}
          title={isSelf ? 'Nie możesz zmienić własnej roli.' : undefined}
          onChange={(e) => setRole(e.target.value as UserRole)}
          data-testid="edit-user-role"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ROLE_LABEL[r]}
            </option>
          ))}
        </select>
      </td>
      <td colSpan={2} />
      <td>
                      <div className="user-actions">
        <button type="button" className="primary" disabled={saving} onClick={() => void save()} data-testid="edit-user-save">
          {saving ? 'Zapisywanie…' : 'Zapisz'}
        </button>
        <button type="button" onClick={onCancel}>
          Anuluj
        </button>
      </div>
      </td>
    </tr>
  )
}
