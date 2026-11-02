/**
 * V-NOT-FOUND-01: 404 Not Found Page
 *
 * Phase: parallel (no data dependency)
 * REQ: REQ-5.2.1.2 Client-side routing with navigation history
 *
 * Pass Criteria:
 * 1. Navigating to unknown route shows 404 status code
 * 2. "Page Not Found" heading visible
 * 3. Attempted path displayed in monospace style
 * 4. "Go to Dashboard" link and "Go Back" button visible
 * 5. "Go to Dashboard" navigates to /dashboard
 */

import { test, expect } from '../../helpers/playwright-fixtures'

test.describe('V-NOT-FOUND-01: 404 Not Found Page', () => {
  test('V-NOT-FOUND-01-S1: unknown route shows 404 with heading and path', async ({ page }) => {
    await page.goto('/this-route-does-not-exist')

    // 404 status code text
    await expect(page.getByText('404')).toBeVisible()

    // Page Not Found heading
    await expect(page.getByRole('heading', { name: 'Page Not Found' })).toBeVisible()

    // Attempted path displayed
    await expect(page.getByText('/this-route-does-not-exist')).toBeVisible()
  })

  test('V-NOT-FOUND-01-S2: navigation buttons visible', async ({ page }) => {
    await page.goto('/nonexistent-page')

    // "Go to Dashboard" link
    const dashboardLink = page.getByRole('link', { name: 'Go to Dashboard' })
    await expect(dashboardLink).toBeVisible()

    // "Go Back" button
    const goBackButton = page.getByRole('button', { name: 'Go Back' })
    await expect(goBackButton).toBeVisible()
  })

  test('V-NOT-FOUND-01-S3: Go to Dashboard navigates correctly', async ({ page }) => {
    await page.goto('/nonexistent-page')

    const dashboardLink = page.getByRole('link', { name: 'Go to Dashboard' })
    await dashboardLink.click()

    await expect(page).toHaveURL(/\/dashboard/)
  })
})
