import { API_BASE_URL } from '../config'
import { ApiError, parseError } from './client'
import type { Health } from './types'

// Publiczny stan wdrożenia (#140), bez tokenu. Przy awarii bazy backend odpowiada 503 z tym samym ciałem
// (status DOWN) – zwracamy je, bo wersja, rewizja i region są wtedy najbardziej potrzebne. Inne błędy rzucają ApiError.
export async function getHealth(signal?: AbortSignal): Promise<Health> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}/health`, { signal, headers: { Accept: 'application/json' } })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Brak połączenia z serwerem. Sprawdź sieć i spróbuj ponownie.')
  }
  const body: unknown = await response.json().catch(() => null)
  const isHealth = typeof body === 'object' && body !== null && 'status' in body && 'database' in body
  if ((response.ok || response.status === 503) && isHealth) return body as Health
  throw parseError(response.status, body)
}
