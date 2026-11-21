// Testy E2E w przeglądarce (headless) na adresie z LIVE_APP_URL.
const { defineConfig, devices } = require('@playwright/test')
const { LIVE_APP_URL } = require('./helpers/env')

module.exports = defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.js',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  // W CI jedna powtórka – wtedy powstaje też ślad (trace) do analizy niestabilnego testu.
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  outputDir: 'test-results',
  use: {
    baseURL: LIVE_APP_URL,
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
