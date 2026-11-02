/**
 * V-DASH-06: Dashboard Live-Refresh Header Indicator (REQ-3.2.2.17)
 *
 * No wireframe: the indicator design is authored in REQ-3.2.2.17.
 *
 * Main Purpose: Verify there is no manual Refresh button and the
 * state-only Live-refresh pill is rendered in the Dashboard header
 * (default healthy state).
 *
 * Pass Criteria:
 * 1. No manual "Refresh" button in the Dashboard header
 * 2. `dashboard-live-status` indicator pill is visible
 * 3. `data-status="live"` attribute present (healthy state)
 * 4. Pill label reads "Live"
 * 5. Status dot uses the info color token and `animate-pulse` class
 *    (pulsing dot signals active auto-refresh)
 *
 * Note: Paused and Reconnecting states are exercised by the frontend
 * unit tests (tests/features/dashboard/components/last-updated-indicator.test.tsx);
 * this visual test only covers the default healthy render, which is
 * what the user sees 99% of the time.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { waitForDashboardLoad } from '../../helpers/dashboard'

test.describe('V-DASH-06: Dashboard Live-Refresh Header Indicator', () => {
  test.beforeEach(async ({ page }) => {
    // Mock /dashboard so the page renders predictably regardless of DB state.
    // The indicator depends only on polling health, not on any data content,
    // so valid-but-empty metrics are enough to reach the rendered state.
    await page.route(`**/localhost:${BACKEND_PORT}/dashboard**`, async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          metrics: {
            tests: { count: 0 },
            suites: { count: 0 },
            regressions: { count: 0 },
            executions: { sinceDays: 1, count: 0, running: 0, passed: 0, failed: 0 },
          },
          recentActivity: [],
          recentExecutions: [],
          meta: { timestamp: new Date().toISOString(), errors: [] },
        }),
      })
    })
  })

  test('V-DASH-06: no manual Refresh button, Live pill visible in header', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    await expect(
      page.getByRole('button', { name: /^refresh$/i }),
      'Manual Refresh button must be removed once auto-refresh is wired'
    ).toHaveCount(0)

    const pill = page.getByTestId('dashboard-live-status')
    await expect(pill, 'Live-refresh indicator pill must be visible').toBeVisible()
    await expect(
      pill,
      'Default healthy state is "live" (tab visible + ticks succeeding)'
    ).toHaveAttribute('data-status', 'live')
    await expect(pill).toContainText('Live')

    const dot = pill.locator('[data-badge-dot]')
    await expect(
      dot,
      'Live dot uses info color token to match other running-state dots in the UI'
    ).toHaveClass(/bg-info/)
    await expect(
      dot,
      'Live dot pulses so the user can see auto-refresh is active at a glance'
    ).toHaveClass(/animate-pulse/)
  })
})
