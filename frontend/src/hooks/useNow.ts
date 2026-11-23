import { useEffect, useState } from 'react'

// Bieżący czas odświeżany co `intervalMs` – jeden timer na stronę zamiast licznika w każdym wierszu.
// Przy ukrytej karcie stoi, a po powrocie od razu się aktualizuje.
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let timer: number | undefined
    const start = () => {
      window.clearInterval(timer)
      setNow(Date.now())
      timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    }
    const onVisibility = () => (document.hidden ? window.clearInterval(timer) : start())

    if (!document.hidden) start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs])

  return now
}
