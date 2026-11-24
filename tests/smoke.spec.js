// Test dymny E2E: strona się ładuje, a stopka pokazuje wersję i prowadzi do /status. Pełny scenariusz: #99.
const { test, expect } = require('@playwright/test')

test('strona startowa ładuje się i pokazuje wersję w stopce', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-version')).toBeVisible()
})

test('strona /status bez logowania pokazuje stan i wersję backendu', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('footer-status').click()
  await expect(page).toHaveURL(/\/status$/)
  await expect(page.getByTestId('status-summary')).toBeVisible({ timeout: 60_000 })
  // Ten sam commit co frontend – CD wdraża backend przed frontendem.
  const frontend = (await page.getByTestId('app-version').getAttribute('title')) ?? ''
  await expect(page.getByTestId('status-backend-commit')).toHaveText(frontend.slice(0, 7))
})
