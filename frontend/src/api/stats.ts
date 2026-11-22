import { request } from './client'
import type { Stats } from './types'

// Pulpit SLA (#138) – tylko technik i administrator; `days` od 7 do 90, domyślnie 30.
export function getStats(days = 30, signal?: AbortSignal): Promise<Stats> {
  return request<Stats>(`/stats?days=${days}`, { signal })
}
