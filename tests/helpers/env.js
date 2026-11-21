// Wspólna konfiguracja testów API i E2E. Wszystko ze zmiennych środowiskowych – bez adresów i haseł w kodzie.
//   LIVE_APP_URL        adres aplikacji (frontend; API pod /api), lokalnie Vite: http://localhost:5173
//   TEST_USER_EMAIL     konto do testów (TECHNICIAN – może też usuwać to, co test utworzy)
//   TEST_USER_PASSWORD  hasło tego konta (lokalnie: DEMO_PASSWORD z backend/.env; w CI: sekret środowiska)

// W CI brak adresu to błąd konfiguracji – nie udajemy, że aplikacja jest na localhost.
if (process.env.CI && !process.env.LIVE_APP_URL) {
  throw new Error('Brak LIVE_APP_URL – w CI testy muszą znać adres wdrożonej aplikacji.')
}
const LIVE_APP_URL = (process.env.LIVE_APP_URL || 'http://localhost:5173').replace(/\/+$/, '')

function testUser() {
  const email = process.env.TEST_USER_EMAIL
  const password = process.env.TEST_USER_PASSWORD
  if (!email || !password) {
    throw new Error('Ustaw TEST_USER_EMAIL i TEST_USER_PASSWORD (konto testowe), np. tech.jan@clouddesk.example.')
  }
  return { email, password }
}

module.exports = { LIVE_APP_URL, testUser }
