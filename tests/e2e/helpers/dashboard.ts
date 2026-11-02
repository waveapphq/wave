import { expect, type Page } from '@playwright/test'

/**
 * Wait for dashboard page to finish loading data.
 * This helper waits for the loading state to complete and data to be rendered.
 */
export async function waitForDashboardLoad(page: Page): Promise<void> {
  // Wait for the dashboard page to be visible. First dashboard navigation
  // in a fresh container can hit a cold Vite preview + first-paint React
  // hydration, so the default 5s is too tight under shard-container CPU
  // load - the V-DASH-01 cold-start flake traces back to here.
  await expect(page.locator('[data-testid="dashboard-page"]')).toBeVisible({ timeout: 30_000 })

  // Wait for loading to complete - no aria-busy="true" and no skeletons
  await page.waitForFunction(() => {
    const dashboard = document.querySelector('[data-testid="dashboard-page"]')
    if (!dashboard) return false
    // Not loading if aria-busy is not "true" (may be absent or "false")
    if (dashboard.getAttribute('aria-busy') === 'true') return false
    // No skeleton elements should be present
    const skeletons = document.querySelectorAll('[data-skeleton]')
    return skeletons.length === 0
  }, undefined, { timeout: 15_000 })

  // Wait for at least one metric count to be visible with a number
  await expect(
    page.locator('[data-testid="metric-count"]').first()
  ).toBeVisible()
}

/**
 * Wait for dashboard with specific test count (for verification).
 */
export async function waitForDashboardWithTests(page: Page, expectedCount: number): Promise<void> {
  await waitForDashboardLoad(page)

  // Wait for Tests metric to show expected count
  await expect(
    page.locator('[data-testid="metric-card-tests"] [data-testid="metric-count"]')
  ).toHaveText(expectedCount.toString())
}
