export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api'

// SHA commita wdrożonej wersji – ustawiany w buildzie przez CD (deploy.yml); lokalnie „local”.
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'local'

// Publiczne repozytorium – strona /status linkuje do wdrożonych commitów.
export const REPO_URL = 'https://github.com/qubit-mindless/clouddesk'

// Przyciski kont demo na ekranie logowania (VITE_DEMO_ACCOUNTS=true) – wpisują e-mail konta z seeda, hasło podaje się samemu.
export const DEMO_ACCOUNTS: { email: string; name: string; role: string }[] =
  import.meta.env.VITE_DEMO_ACCOUNTS === 'true'
    ? [
        { email: 'anna.k@clouddesk.example', name: 'Anna Kaczmarek', role: 'Zgłaszający' },
        { email: 'tech.jan@clouddesk.example', name: 'Jan Kowalski', role: 'Technik' },
        { email: 'admin@clouddesk.example', name: 'Administrator', role: 'Administrator' },
      ]
    : []
