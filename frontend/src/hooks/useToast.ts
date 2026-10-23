import { createContext, useContext } from 'react'

export type ToastVariant = 'success' | 'error'
export type ShowToast = (message: string, variant?: ToastVariant) => void

export const ToastContext = createContext<ShowToast>(() => {})

export function useToast(): ShowToast {
  return useContext(ToastContext)
}
