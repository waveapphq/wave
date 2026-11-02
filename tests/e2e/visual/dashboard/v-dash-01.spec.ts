/**
 * V-DASH-01: Dashboard Empty State
 *
 * Main Purpose: Dashboard shows empty states when no data exists.
 *
 * Pass Criteria:
 * 1. All metric cards show "0" with no subtitles
 * 2. Recent Activity shows "No recent activity" message
 * 3. Recent Executions shows "No recent executions" message
 *
 * Note: Quick Actions tested separately in V-DASH-05.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'
import { BACKEND_PORT } from '../../helpers/config'

test.describe('V-DASH-01: Dashboard Empty', () => {
  // Mock API to return empty data to ensure test isolation
  test.beforeEach(async ({ page }) => {
    // Mock dashboard API to return empty metrics
    await page.route(`**/localhost:${BACKEND_PORT}/dashboard**`, async (route) => {
      if (route.request().method() === 'GET') {
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
            meta: {
              timestamp: new Date().toISOString(),
              errors: [],
            },
          }),
        })
      } else {
        await route.continue()
      }
    })
  })

  test('V-DASH-01: dashboard displays empty state with zero metrics', async ({
    page,
  }) => {
    // Navigate to dashboard with empty/fresh state
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // Page title should show "Dashboard"
    const pageTitle = page.getByRole('heading', { name: 'Dashboard', level: 1 })
    await expect(pageTitle, 'Page title should be "Dashboard"').toBeVisible()

    // 1. Metric cards show "0" count (no subtitles for tests/suites/regressions)
    // Tests card: "0" with no subtitle
    const testsCard = page.locator('[data-testid="metric-card-tests"]')
    await expect(testsCard, 'Tests metric card should be visible').toBeVisible()
    const testsCount = testsCard.locator('[data-testid="metric-count"]')
    await expect(testsCount, 'Tests count should show 0').toHaveText('0')
    const testsSubtitle = testsCard.locator('[data-testid="metric-subtitle"]')
    await expect(testsSubtitle, 'Tests card should have no subtitle').toHaveCount(0)

    // Suites card: "0" with no subtitle
    const suitesCard = page.locator('[data-testid="metric-card-suites"]')
    await expect(
      suitesCard,
      'Suites metric card should be visible'
    ).toBeVisible()
    const suitesCount = suitesCard.locator('[data-testid="metric-count"]')
    await expect(suitesCount, 'Suites count should show 0').toHaveText('0')
    const suitesSubtitle = suitesCard.locator('[data-testid="metric-subtitle"]')
    await expect(suitesSubtitle, 'Suites card should have no subtitle').toHaveCount(0)

    // Regressions card: "0" with no subtitle
    const regressionsCard = page.locator(
      '[data-testid="metric-card-regressions"]'
    )
    await expect(
      regressionsCard,
      'Regressions metric card should be visible'
    ).toBeVisible()
    const regressionsCount = regressionsCard.locator(
      '[data-testid="metric-count"]'
    )
    await expect(
      regressionsCount,
      'Regressions count should show 0'
    ).toHaveText('0')
    const regressionsSubtitle = regressionsCard.locator(
      '[data-testid="metric-subtitle"]'
    )
    await expect(regressionsSubtitle, 'Regressions card should have no subtitle').toHaveCount(0)

    // Executions (24h) card: "0" with no subtitle (empty state)
    const executionsCard = page.locator(
      '[data-testid="metric-card-executions"]'
    )
    await expect(
      executionsCard,
      'Executions metric card should be visible'
    ).toBeVisible()
    const executionsCount = executionsCard.locator(
      '[data-testid="metric-count"]'
    )
    await expect(
      executionsCount,
      'Executions count should show 0'
    ).toHaveText('0')
    const executionsSubtitle = executionsCard.locator(
      '[data-testid="metric-subtitle"]'
    )
    await expect(executionsSubtitle, 'Executions card should have no subtitle in empty state').toHaveCount(0)
  })

  test('V-DASH-01-S1: Recent Activity shows empty state message', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // 2. Recent Activity shows "No recent activity" message
    const recentActivitySection = page.locator(
      '[data-testid="recent-activity-section"]'
    )
    await expect(
      recentActivitySection,
      'Recent Activity section should be visible'
    ).toBeVisible()

    // Section header should still be present
    await expect(
      recentActivitySection.getByRole('heading', { name: 'Recent Activity' }),
      'Recent Activity header should be visible'
    ).toBeVisible()

    // Empty state message: "No recent activity"
    const emptyMessage = recentActivitySection.locator(
      '[data-testid="empty-state-title"]'
    )
    await expect(emptyMessage).toContainText(/No recent activity/i)

    // Empty state description: "Create your first test to get started"
    const emptyDescription = recentActivitySection.locator(
      '[data-testid="empty-state-description"]'
    )
    await expect(emptyDescription).toContainText(
      /Create your first test to get started/i
    )

    // No activity items should be present
    const activityItems = recentActivitySection.locator(
      '[data-testid="activity-item"]'
    )
    await expect(activityItems).toHaveCount(0)
  })

  test('V-DASH-01-S2: Recent Executions shows empty state message', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // 3. Recent Executions shows "No recent executions" message
    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(
      recentExecutionsSection,
      'Recent Executions section should be visible'
    ).toBeVisible()

    // Section header should still be present
    await expect(
      recentExecutionsSection.getByRole('heading', { name: 'Recent Executions' }),
      'Recent Executions header should be visible'
    ).toBeVisible()

    // Empty state message: "No recent executions"
    const emptyMessage = recentExecutionsSection.locator(
      '[data-testid="empty-state-title"]'
    )
    await expect(emptyMessage).toContainText(/No recent executions/i)

    // Empty state description: "Run a test or regression to see progress"
    const emptyDescription = recentExecutionsSection.locator(
      '[data-testid="empty-state-description"]'
    )
    await expect(emptyDescription).toContainText(
      /Run a test or regression to see progress/i
    )

    // No execution cards should be present
    const executionCards = recentExecutionsSection.locator(
      '[data-testid="execution-card"]'
    )
    await expect(executionCards).toHaveCount(0)
  })

})
