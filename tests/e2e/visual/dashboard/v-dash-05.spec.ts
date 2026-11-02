/**
 * V-DASH-05: Dashboard Quick Actions
 *
 * Main Purpose: Quick Actions section provides shortcuts for common workflows.
 *
 * Design Decisions: DASH-3
 * - DASH-3: Quick Actions: New Test, Run Regression, View Reports
 *
 * Pass Criteria:
 * 1. Always 3 actions: New Test, Run Regression, View Reports
 * 2. Buttons in horizontal row layout
 * 3. Each button has exact title and description text
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'

// Expected quick actions with exact text from implementation
const EXPECTED_ACTIONS = {
  newTest: {
    testId: 'quick-action-new-test',
    title: 'New Test',
    description: 'Create a new test from scratch',
  },
  runRegression: {
    testId: 'quick-action-run-regression',
    title: 'Run Regression',
    description: 'Execute a regression test suite',
  },
  viewReports: {
    testId: 'quick-action-view-reports',
    title: 'View Reports',
    description: 'Analyze test results and trends',
  },
}

test.describe('V-DASH-05: Dashboard Quick Actions', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/scripts/reset.sh')
    exec('./tests/e2e/fixtures/dashboard/v-dash-05/01-seed.sh')
  })

  test('V-DASH-05: shows 3 actions with exact titles and descriptions', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const quickActionsSection = page.locator(
      '[data-testid="quick-actions-section"]'
    )
    await expect(quickActionsSection, 'Quick Actions section should be visible').toBeVisible()

    // Section header
    await expect(
      quickActionsSection.getByText('Quick Actions'),
      'Quick Actions header should be visible'
    ).toBeVisible()

    // Exactly 3 quick actions
    const allQuickActions = quickActionsSection.locator(
      '[data-testid^="quick-action-"]'
    )
    await expect(allQuickActions, 'Should have exactly 3 quick actions').toHaveCount(3)

    // Verify each action with exact text
    for (const action of Object.values(EXPECTED_ACTIONS)) {
      const node = quickActionsSection.locator(`[data-testid="${action.testId}"]`)
      await expect(node, `${action.title} action should be visible`).toBeVisible()
      await expect(node).toContainText(action.title)
      await expect(node).toContainText(action.description)
    }
  })

  test('V-DASH-05-S2: quick actions in horizontal row layout', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const quickActionsSection = page.locator(
      '[data-testid="quick-actions-section"]'
    )
    await expect(quickActionsSection).toBeVisible()

    const newTestAction = quickActionsSection.locator(
      `[data-testid="${EXPECTED_ACTIONS.newTest.testId}"]`
    )
    const runRegressionAction = quickActionsSection.locator(
      `[data-testid="${EXPECTED_ACTIONS.runRegression.testId}"]`
    )
    const viewReportsAction = quickActionsSection.locator(
      `[data-testid="${EXPECTED_ACTIONS.viewReports.testId}"]`
    )

    const newTestBox = await newTestAction.boundingBox()
    const runRegressionBox = await runRegressionAction.boundingBox()
    const viewReportsBox = await viewReportsAction.boundingBox()

    expect(
      newTestBox !== null && runRegressionBox !== null && viewReportsBox !== null,
      'All quick action buttons must have bounds'
    ).toBe(true)

    expect(
      Math.abs(newTestBox!.y - runRegressionBox!.y) < 10,
      'New Test and Run Regression should be in the same row'
    ).toBe(true)
    expect(
      Math.abs(runRegressionBox!.y - viewReportsBox!.y) < 10,
      'Run Regression and View Reports should be in the same row'
    ).toBe(true)

    expect(newTestBox!.x < runRegressionBox!.x, 'New Test should be left of Run Regression').toBe(true)
    expect(runRegressionBox!.x < viewReportsBox!.x, 'Run Regression should be left of View Reports').toBe(true)
  })
})
