import { request } from './client'
import type { LoginResponse, User } from './types'

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

// Zmiana własnego hasła (każdy zalogowany). 204 bez treści; złe obecne hasło → 422 przy polu currentPassword.
export function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  return request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) })
}

export function getMe(signal?: AbortSignal): Promise<User> {
  return request<User>('/auth/me', { signal })
}
