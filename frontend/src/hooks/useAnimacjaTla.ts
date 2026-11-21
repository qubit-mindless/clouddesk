import { useEffect, useState } from 'react'

const KLUCZ = 'clouddesk.animacjaTla'

function zapamietane(): boolean {
  try {
    return localStorage.getItem(KLUCZ) !== 'stop'
  } catch {
    return true // prywatne okno albo zablokowany storage – domyślnie animacja włączona
  }
}

/**
 * Włączanie i zatrzymywanie animowanego tła (WCAG 2.2.2: ruch dłuższy niż 5 s musi dać się zatrzymać).
 * Ustawia html[data-tlo] – CSS podmienia wtedy animację na nieruchomą klatkę. Wybór zapamiętany w przeglądarce.
 */
export function useAnimacjaTla(): [boolean, () => void] {
  const [wlaczona, setWlaczona] = useState(zapamietane)

  useEffect(() => {
    document.documentElement.dataset.tlo = wlaczona ? 'ruch' : 'stop'
    try {
      localStorage.setItem(KLUCZ, wlaczona ? 'ruch' : 'stop')
    } catch {
      // bez zapamiętania – działa do odświeżenia strony
    }
  }, [wlaczona])

  return [wlaczona, () => setWlaczona((v) => !v)]
}
