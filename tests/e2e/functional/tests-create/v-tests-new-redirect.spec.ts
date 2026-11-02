/**
 * `/tests/new` redirects to `/workbench?newTest=true`.
 *
 * 1. Navigating to `/tests/new` serves the router's Navigate component
 *    which replace-redirects to `/workbench?newTest=true`. The
 *    `newTest=true` query is consumed by the lifecycle hook and the
 *    URL should end up as plain `/workbench` with a blank canvas.
 * 2. Dashboard Quick Actions "Create Test" calls the same navigation
 *    helper and therefore hits the same path.
 *
 * The blank-canvas assertion keys off the start node + onboarding
 * placeholder testids rendered by the empty-state components.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

async function assertBlankCanvas(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('[data-testid="workbench-page"]')).toBeVisible({ timeout: 10_000 })
  // data-mode identifies the live container (history mode would be
  // reached only via /executions/history/:runId).
  await expect(page.locator('[data-testid="workbench-page"]')).toHaveAttribute('data-mode', 'live')
  // Empty-state chrome: start node + onboarding placeholder.
  await expect(page.locator('[data-testid="start-node"]')).toBeVisible()
  await expect(page.locator('[data-testid="onboarding-placeholder"]')).toBeVisible()
}

test.describe('/tests/new redirects to /workbench with blank canvas', () => {
  test.beforeAll(() => {
    // Reset is enough - no fixtures needed for a clean canvas.
    exec('./tests/e2e/scripts/reset.sh')
  })

  test('goto /tests/new lands on /workbench and shows empty state', async ({ page }) => {
    await page.goto('/tests/new')
    // End URL should be /workbench (query stripped by the lifecycle hook).
    await expect(page).toHaveURL(/\/workbench(\?[^?]*)?$/)
    await assertBlankCanvas(page)

    // The newTest query should be stripped after consumption.
    const url = new URL(page.url())
    expect(url.searchParams.get('newTest'), 'newTest query consumed').toBeNull()
  })
})

test.describe('Dashboard "Create Test" quick action routes to blank workbench', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/scripts/reset.sh')
  })

  test('New Test from Dashboard lands on blank workbench', async ({ page }) => {
    await page.goto('/dashboard')
    // Dashboard exposes the new-test shortcut as a Quick Action card
    // titled "New Test" (testid `quick-action-new-test`). It wires
    // through onNewTest -> navigate('/tests/new') which the router
    // redirects to /workbench?newTest=true.
    const quickAction = page.getByTestId('quick-action-new-test')
    await expect(quickAction, 'New Test quick action visible').toBeVisible()
    await quickAction.click()
    await expect(page).toHaveURL(/\/workbench(\?[^?]*)?$/)
    await assertBlankCanvas(page)
  })
})
