// Token dostępu z /auth/login. Trzymamy go w sessionStorage: przetrwa odświeżenie strony,
// ale znika po zamknięciu karty i nie jest wysyłany automatycznie jak cookie (brak CSRF).
const TOKEN_KEY = 'clouddesk.accessToken'

type Listener = () => void
const listeners = new Set<Listener>()

// Kopia w pamięci: gdy przeglądarka blokuje storage, sesja działa do odświeżenia strony.
let memoryToken: string | null = readStored()

function readStored(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function getToken(): string | null {
  return memoryToken
}

export function setToken(token: string): void {
  memoryToken = token
  try {
    sessionStorage.setItem(TOKEN_KEY, token)
  } catch {
    // zostaje tylko kopia w pamięci
  }
}

export function clearToken(): void {
  memoryToken = null
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    // jak wyżej
  }
}

// Klient API zgłasza tu 401 (token wygasł albo jest nieważny); AuthProvider wylogowuje użytkownika.
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function expireSession(): void {
  clearToken()
  listeners.forEach((listener) => listener())
}
