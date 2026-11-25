import { useEffect, useState } from 'react'

// Wartość „po chwili spokoju”: np. wyszukiwanie wysyła zapytanie dopiero, gdy użytkownik przestanie pisać.
export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])
  return debounced
}
