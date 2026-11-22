import { request } from './client'
import type { AssistantConversation, AssistantSummary } from './types'

export function getAssistant(ticketId: number, signal?: AbortSignal): Promise<AssistantConversation> {
  return request<AssistantConversation>(`/tickets/${ticketId}/assistant`, { signal })
}

// Bez `message` asystent proponuje pierwsze rozwiązanie na podstawie samego zgłoszenia.
export function askAssistant(ticketId: number, message?: string): Promise<AssistantConversation> {
  return request<AssistantConversation>(`/tickets/${ticketId}/assistant`, {
    method: 'POST',
    body: JSON.stringify(message === undefined ? {} : { message }),
  })
}

// Podsumowanie rozmowy dla technika (#143, opcjonalne). 429, gdy poprzednie powstało niedawno.
export function summarizeConversation(ticketId: number): Promise<AssistantSummary> {
  return request<AssistantSummary>(`/tickets/${ticketId}/assistant/summary`, { method: 'POST', body: '{}' })
}
