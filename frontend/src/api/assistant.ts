import { request } from './client'
import type { AssistantConversation } from './types'

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
