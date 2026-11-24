import { useSyncExternalStore } from 'react'

function subscribe(onChange: () => void) {
  window.addEventListener('online', onChange)
  window.addEventListener('offline', onChange)
  return () => {
    window.removeEventListener('online', onChange)
    window.removeEventListener('offline', onChange)
  }
}

// Czy przeglądarka ma sieć (zdarzenia `online`/`offline`). `false` jest pewne; `true` znaczy tylko, że jest
// jakieś połączenie – czy dojdziemy do serwera, i tak pokaże dopiero odpowiedź na żądanie.
export function useOnline(): boolean {
  return useSyncExternalStore(subscribe, () => navigator.onLine)
}
