/**
 * V-NAV-FUNCTIONS-01: Sidebar Functions entry.
 * Design Decisions: FNLIST-11
 * REQ: REQ-3.1.2.1
 *
 * The LIBRARY section links to Functions (route /functions, FunctionSquare
 * icon, indigo #818CF8). WAVE has no /blocks route.
 *
 * Pass Criteria:
 * 1. Sidebar LIBRARY shows a Functions link to /functions; no /blocks link.
 * 2. Clicking it routes client-side to the Functions library page.
 * 3. /blocks renders the 404 page (not a Functions/Blocks page).
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-NAV-FUNCTIONS-01: Sidebar Functions entry', () => {
  test('V-NAV-FUNCTIONS-01-S1: LIBRARY shows Functions -> /functions, no Blocks link', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    const sidebar = page.locator('[data-sidebar="sidebar"]')
    await expect(sidebar).toBeVisible()

    const functionsLink = sidebar.locator('a[href="/functions"]')
    await expect(functionsLink).toBeVisible()
    await expect(functionsLink).toContainText('Functions')
    // The FunctionSquare icon renders inside the link.
    await expect(functionsLink.locator('svg')).toBeVisible()

    // No sidebar link points to /blocks.
    await expect(sidebar.locator('a[href="/blocks"]')).toHaveCount(0)
  })

  test('V-NAV-FUNCTIONS-01-S2: clicking Functions routes to the library list', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await page.locator('[data-sidebar="sidebar"] a[href="/functions"]').click()
    await expect(page).toHaveURL(/\/functions$/)
    await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
  })

  test('V-NAV-FUNCTIONS-01-S3: the removed /blocks route renders 404', async ({
    page,
  }) => {
    await page.goto('/blocks')
    await expect(page.getByText('404')).toBeVisible()
    await expect(page.locator('[data-testid="functions-page"]')).toHaveCount(0)
  })
})
