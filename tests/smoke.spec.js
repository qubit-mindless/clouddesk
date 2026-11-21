// Test dymny E2E: strona się ładuje, a stopka pokazuje wersję. Pełny scenariusz: #99.
const { test, expect } = require('@playwright/test')

test('strona startowa ładuje się i pokazuje wersję w stopce', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('app-version')).toBeVisible()
})
