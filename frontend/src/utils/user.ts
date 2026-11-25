import type { User } from '../api/types'

// Imię do powitania („Dzień dobry, Jan”) – pierwszy wyraz pełnego imienia i nazwiska.
export function firstName(user: User | null | undefined): string {
  return user?.fullName.trim().split(/\s+/)[0] ?? ''
}
