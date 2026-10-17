import { API_BASE_URL } from '../config'

// Błędy walidacji przypięte do pól formularza, np. { title: 'Tytuł jest za krótki' }.
export type FieldErrors = Partial<Record<string, string>>

export class ApiError extends Error {
  readonly status: number
  readonly fieldErrors: FieldErrors

  constructor(status: number, message: string, fieldErrors: FieldErrors = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.fieldErrors = fieldErrors
  }
}

const STATUS_MESSAGE: Record<number, string> = {
  400: 'Serwer odrzucił żądanie.',
  404: 'Nie znaleziono zasobu.',
  422: 'Popraw zaznaczone pola.',
  500: 'Błąd serwera. Spróbuj ponownie za chwilę.',
}

// FastAPI zwraca 422 jako { detail: [{ loc: ['body', 'title'], msg: '...' }] }, a inne błędy jako { detail: '...' }.
function parseError(status: number, body: unknown): ApiError {
  const detail = (body as { detail?: unknown } | null)?.detail
  const fieldErrors: FieldErrors = {}

  if (Array.isArray(detail)) {
    for (const item of detail as { loc?: unknown[]; msg?: string }[]) {
      const field = item.loc?.at(-1)
      if (typeof field === 'string' && item.msg && !fieldErrors[field]) fieldErrors[field] = item.msg
    }
  }

  // Treść błędu 5xx z serwera nic nie mówi użytkownikowi, więc pokazujemy ją tylko dla 4xx.
  const fallback = STATUS_MESSAGE[status] ?? STATUS_MESSAGE[status >= 500 ? 500 : 400]
  const message = typeof detail === 'string' && status < 500 ? detail : fallback
  return new ApiError(status, message, fieldErrors)
}

export function errorMessage(error: unknown): string {
  return error instanceof ApiError ? error.message : 'Coś poszło nie tak. Spróbuj ponownie.'
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.')
  }

  if (response.status === 204) return undefined as T
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) throw parseError(response.status, body)
  return body as T
}
