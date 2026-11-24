import { useEffect, useRef } from 'react'
import { useOnline } from '../hooks/useOnline'
import { useToast } from '../hooks/useToast'

// Pasek u góry strony, gdy przeglądarka straci sieć. To, co już się wczytało, zostaje na ekranie;
// zapis kończy się komunikatem „Brak połączenia z serwerem”, a przyciski są zablokowane na czas wysyłki.
export function OfflineBanner() {
  const online = useOnline()
  const toast = useToast()
  const wasOffline = useRef(false)

  useEffect(() => {
    if (!online) wasOffline.current = true
    else if (wasOffline.current) {
      wasOffline.current = false
      toast('Połączenie wróciło.')
    }
  }, [online, toast])

  if (online) return null
  return (
    <div className="offline-banner" role="status" data-testid="offline-banner">
      <strong>Brak połączenia z internetem.</strong> Możesz przeglądać to, co już się wczytało – zapis zadziała po
      powrocie sieci.
    </div>
  )
}
