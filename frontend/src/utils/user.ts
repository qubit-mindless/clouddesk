import type { User } from '../api/types'

// Imię do powitania („Dzień dobry, Jan”) – pierwszy wyraz pełnego imienia i nazwiska.
export function firstName(user: User | null | undefined): string {
  return user?.fullName.trim().split(/\s+/)[0] ?? ''
}

// „Imię Nazwisko (login)”, a gdy nazwiska brak albo jest równe loginowi – sam login.
export function personLabel(name: string | null | undefined, login: string): string {
  return name && name !== login ? `${name} (${login})` : login
}
