import { useCallback, useState, type ReactNode } from 'react'
import { ToastContext, type ShowToast, type ToastVariant } from '../hooks/useToast'

interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

const TOAST_TIMEOUT_MS = 4000

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const show = useCallback<ShowToast>(
    (message, variant = 'success') => {
      const id = Date.now() + Math.random()
      setToasts((list) => [...list, { id, message, variant }])
      setTimeout(() => dismiss(id), TOAST_TIMEOUT_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext value={show}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.variant}`} data-testid={`toast-${t.variant}`}>
            {t.message}
            <button type="button" aria-label="Zamknij" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  )
}
