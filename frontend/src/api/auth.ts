import { request } from './client'
import type { LoginResponse, User } from './types'

export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })
}

export function getMe(signal?: AbortSignal): Promise<User> {
  return request<User>('/auth/me', { signal })
}
