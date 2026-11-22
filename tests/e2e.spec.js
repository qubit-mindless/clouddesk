// Scenariusz E2E kluczowej ścieżki (#99): logowanie → nowe zgłoszenie przez formularz → widoczne na liście
// → szczegół → usunięcie. Selektory wyłącznie po data-testid i etykietach pól (bez klas CSS).
//
//   LIVE_APP_URL=… TEST_USER_EMAIL=tech.jan@clouddesk.example TEST_USER_PASSWORD=… npm run test:e2e
//
// Konto musi móc usuwać zgłoszenia (technik lub administrator). Gdy test przerwie się w połowie,
// afterAll loguje się przez API i usuwa utworzone zgłoszenie, żeby nie zostawiać śmieci na produkcji.
const { test, expect } = require('@playwright/test')
const { testUser } = require('./helpers/env')

// Znacznik w tytule, żeby zgłoszenie z testu dało się rozpoznać, gdyby sprzątanie się nie udało.
const TITLE = `[e2e ${new Date().toISOString()}] Drukarka na 2 piętrze nie drukuje`
const DESCRIPTION = 'Zgłoszenie utworzone przez test E2E (Playwright). Test usuwa je na końcu.'

// Id zgłoszenia utworzonego przez test; null = nic nie zostało do posprzątania.
let createdId = null

test.afterAll(async ({ request }) => {
  if (createdId === null) return
  // Sprzątanie awaryjne: test nie doszedł do usunięcia przez UI. Świeże logowanie przez API (a nie token
  // z przeglądarki, który mógł już wygasnąć). Niepowodzenie oblewa przebieg – śmieć na produkcji ma być widoczny.
  const { email, password } = testUser()
  const login = await request.post('/api/auth/login', { data: { email, password } })
  expect(login.status(), 'logowanie do sprzątania').toBe(200)
  const { accessToken } = await login.json()
  const res = await request.delete(`/api/tickets/${createdId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  // 404 = już usunięte.
  expect([204, 404], `usunięcie zgłoszenia #${createdId} (${TITLE})`).toContain(res.status())
  createdId = null
})

test('logowanie → nowe zgłoszenie → lista → szczegół → usunięcie', async ({ page }) => {
  const { email, password } = testUser()

  await test.step('logowanie', async () => {
    await page.goto('/tickets')
    // Niezalogowany trafia na ekran logowania.
    await expect(page.getByTestId('login-form')).toBeVisible()
    await page.getByTestId('login-email').fill(email)
    await page.getByTestId('login-password').fill(password)
    await page.getByTestId('login-submit').click()
    await expect(page.getByTestId('user-menu')).toBeVisible()
    await expect(page.getByTestId('ticket-list')).toBeVisible()
  })

  await test.step('nowe zgłoszenie przez formularz', async () => {
    await page.getByTestId('ticket-new').click()
    await expect(page.getByTestId('ticket-form')).toBeVisible()
    await page.getByLabel('Tytuł *').fill(TITLE)
    // Priorytet to kafelki (radio) z opisem i czasem SLA – pole radio jest wizualnie ukryte pod kafelkiem.
    await page.getByTestId('ticket-form-priority-P2').check({ force: true })
    await page.getByLabel('Opis *').fill(DESCRIPTION)
    // Id bierzemy z odpowiedzi API od razu po zapisie – zanim padnie jakakolwiek asercja, żeby afterAll
    // mógł posprzątać także wtedy, gdy kolejne sprawdzenie się nie powiedzie.
    const [created] = await Promise.all([
      page.waitForResponse((res) => new URL(res.url()).pathname === '/api/tickets' && res.request().method() === 'POST'),
      page.getByTestId('ticket-form-submit').click(),
    ])
    expect(created.status()).toBe(201)
    createdId = (await created.json()).id

    // Po zapisie aplikacja przechodzi do szczegółów nowego zgłoszenia: /tickets/{id}.
    // Komunikaty mogą się nakładać (poprzedni jeszcze nie zniknął) – szukamy konkretnego po treści.
    await expect(page.getByTestId('toast-success').filter({ hasText: 'Utworzono zgłoszenie' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/tickets/${createdId}$`))
    await expect(page.getByTestId('ticket-details')).toContainText(TITLE)
  })

  await test.step('zgłoszenie widoczne na liście', async () => {
    await page.getByTestId('ticket-back').click()
    await page.getByTestId('ticket-search').fill(TITLE)
    const row = page.getByTestId(`ticket-row-${createdId}`)
    await expect(row).toBeVisible()
    await expect(row).toContainText(TITLE)
  })

  await test.step('szczegół zgłoszenia', async () => {
    await page.getByTestId(`ticket-row-${createdId}`).click()
    const details = page.getByTestId('ticket-details')
    await expect(details).toContainText(TITLE)
    await expect(details).toContainText(DESCRIPTION)
    await expect(details).toContainText('P2')
    await expect(details).toContainText('Nowe')
  })

  await test.step('usunięcie (sprzątanie)', async () => {
    page.once('dialog', (dialog) => dialog.accept())
    await page.getByTestId('ticket-delete').click()
    await expect(
      page.getByTestId('toast-success').filter({ hasText: `Usunięto zgłoszenie #${createdId}.` }),
    ).toBeVisible()
    // Powrót na listę z zachowanym wyszukiwaniem po unikalnym tytule – po usunięciu nie ma już żadnego wyniku.
    await expect(page).toHaveURL(/\/tickets(\?|$)/)
    await expect(page.getByTestId('ticket-search')).toHaveValue(TITLE)
    await expect(page.getByTestId('ticket-list-empty')).toBeVisible()
    await expect(page.getByTestId(`ticket-row-${createdId}`)).toHaveCount(0)
    createdId = null
  })
})
