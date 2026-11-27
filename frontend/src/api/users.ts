import { request } from './client'
import type { UserAdmin, UserAdminPage, UserCreate, UserCreated, UserRole, UserUpdate } from './types'

// Panel administratora: konta użytkowników (backend przepuszcza tylko rolę ADMIN).
export function getUsers(query: { q?: string; role?: UserRole } = {}, signal?: AbortSignal): Promise<UserAdminPage> {
  const params = new URLSearchParams([['size', '100']])
  if (query.q) params.set('q', query.q)
  if (query.role) params.set('role', query.role)
  return request<UserAdminPage>(`/users?${params}`, { signal })
}

export function createUser(data: UserCreate): Promise<UserCreated> {
  return request<UserCreated>('/users', { method: 'POST', body: JSON.stringify(data) })
}

export function updateUser(id: number, data: UserUpdate): Promise<UserAdmin> {
  return request<UserAdmin>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) })
}

export function resetPassword(id: number): Promise<{ temporaryPassword: string }> {
  return request<{ temporaryPassword: string }>(`/users/${id}/reset-password`, { method: 'POST', body: '{}' })
}
