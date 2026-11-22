import { request } from './client'
import type { Activity, MeSummary, Notifications } from './types'

// Pakiet z makiety: aktywność, powiadomienia i podsumowanie użytkownika (docs/api-kontrakty.md).

export function getActivity(limit = 20, signal?: AbortSignal): Promise<Activity> {
  return request<Activity>(`/activity?limit=${limit}`, { signal })
}

export function getNotifications(signal?: AbortSignal): Promise<Notifications> {
  return request<Notifications>('/notifications', { signal })
}

export function markNotificationsRead(): Promise<void> {
  return request<void>('/notifications/read', { method: 'POST', body: '{}' })
}

export function getMeSummary(signal?: AbortSignal): Promise<MeSummary> {
  return request<MeSummary>('/me/summary', { signal })
}
