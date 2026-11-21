import { useEffect, useState } from 'react'

// Ten sam klucz i atrybut czyta skrypt w index.html przed pierwszym malowaniem strony – zmieniaj w obu miejscach.
export const STORAGE_KEY = 'clouddesk.backgroundAnimation'

function readStoredPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'paused'
  } catch {
    return true // prywatne okno albo zablokowany storage – domyślnie animacja włączona
  }
}

function applyToDocument(enabled: boolean) {
  document.documentElement.dataset.background = enabled ? 'playing' : 'paused'
}

/**
 * Włączanie i zatrzymywanie animowanego tła (WCAG 2.2.2: ruch dłuższy niż 5 s musi dać się zatrzymać).
 * Ustawia html[data-background] – CSS podmienia wtedy animację na nieruchomą klatkę. Wybór zapisuje się tylko
 * po kliknięciu (nowa karta nie nadpisuje ustawienia), a inne karty dostają zmianę przez zdarzenie `storage`.
 */
export function useBackgroundAnimation(): [boolean, () => void] {
  const [enabled, setEnabled] = useState(readStoredPreference)

  useEffect(() => {
    applyToDocument(enabled)
  }, [enabled])

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) setEnabled(event.newValue !== 'paused')
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const toggle = () => {
    const next = !enabled
    setEnabled(next)
    try {
      localStorage.setItem(STORAGE_KEY, next ? 'playing' : 'paused')
    } catch {
      // bez zapamiętania – działa do odświeżenia strony
    }
  }

  return [enabled, toggle]
}
