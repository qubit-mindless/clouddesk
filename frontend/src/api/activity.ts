import { request } from './client'
import type { Activity, MeSummary, Notifications } from './types'

// Aktywność na żywo, powiadomienia (dzwonek) i liczniki powitania /me/summary – kontrakty w docs/api-kontrakty.md.

export function getActivity(limit = 20, signal?: AbortSignal): Promise<Activity> {
  return request<Activity>(`/activity?limit=${limit}`, { signal })
}

export function getNotifications(signal?: AbortSignal): Promise<Notifications> {
  return request<Notifications>('/notifications', { signal })
}

// `until` = czas najnowszego pokazanego powiadomienia – to, co przyszło później, zostaje nieprzeczytane.
export function markNotificationsRead(until?: string): Promise<void> {
  return request<void>('/notifications/read', { method: 'POST', body: JSON.stringify(until ? { until } : {}) })
}

export function getMeSummary(signal?: AbortSignal): Promise<MeSummary> {
  return request<MeSummary>('/me/summary', { signal })
}
