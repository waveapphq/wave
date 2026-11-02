/**
 * Environments page - functional test
 *
 * The Environments settings page must not appear blank because GET /environments
 * hangs. A route declared at "/" instead of "" answers /environments (no trailing
 * slash) with a 307; the relative redirect, proxied through Vite's /api rule, lands
 * at a path without /api, so the request never reaches the BE.
 *
 * Coverage strategy: load /settings/environments, watch every response
 * for a /environments URL, fail on any 3xx, then verify the seeded rows
 * actually render. This catches BE regressions even though Playwright
 * runs against `vite preview` (where VITE_API_BASE_URL is baked in and
 * the dev proxy is not exercised).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/settings/v-env-page-01/01-seed.sh')
})

test.describe('Environments page: list loads without redirects', () => {
  test('GET /environments returns 200 directly and rows render', async ({ page }) => {
    // Capture every /environments response so we can assert no 3xx redirects
    // happened between the page load and the table appearing.
    const envResponses: { url: string; status: number }[] = []
    page.on('response', (response) => {
      const url = response.url()
      // Match the list endpoint specifically. Subpath responses (/names,
      // /tags, /{id}) are unaffected by the trailing-slash trap so we
      // ignore them.
      if (/\/environments(?:\?|$)/.test(url)) {
        envResponses.push({ url, status: response.status() })
      }
    })

    await page.goto('/settings/environments')

    // Wait for the page chrome.
    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="settings-page"][aria-busy="false"]', {
      state: 'attached',
    })

    // The seeded rows must render. If the API call hung or got stuck on a
    // redirect chain the table would stay empty and this would time out.
    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="environment-row"]', { state: 'visible' })

    const rowCount = await page.locator('[data-testid="environment-row"]').count()
    expect(rowCount, 'Seeded environments must show in the table').toBeGreaterThanOrEqual(3)

    // Verify each seeded row is present.
    await expect(
      page.locator('[data-testid="environment-row"]', { hasText: 'EnvPageProd' }),
      'EnvPageProd row visible',
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="environment-row"]', { hasText: 'EnvPageStaging' }),
      'EnvPageStaging row visible',
    ).toBeVisible()
    await expect(
      page.locator('[data-testid="environment-row"]', { hasText: 'EnvPageDev' }),
      'EnvPageDev row visible',
    ).toBeVisible()

    // Now assert NO redirect was seen on the /environments list endpoint.
    // The BE route must serve the canonical path directly.
    const redirects = envResponses.filter((r) => r.status >= 300 && r.status < 400)
    expect(
      redirects,
      `GET /environments must not redirect. Saw: ${JSON.stringify(redirects)}`,
    ).toEqual([])

    // At least one 200 response confirms the list endpoint actually answered.
    const successResponses = envResponses.filter((r) => r.status === 200)
    expect(
      successResponses.length,
      `Expected at least one 200 from /environments. All responses: ${JSON.stringify(envResponses)}`,
    ).toBeGreaterThan(0)
  })

  test('New Environment button is reachable and the action header is wired', async ({ page }) => {
    await page.goto('/settings/environments')
    await page.waitForSelector('[data-testid="settings-page"]', { state: 'visible' })
    await page.waitForSelector('[data-testid="environments-table"]', { state: 'visible' })

    const newButton = page.getByRole('button', { name: /New Environment/i })
    await expect(newButton, 'New Environment button visible').toBeVisible()
    await expect(newButton).toBeEnabled()
  })
})
