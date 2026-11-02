/**
 * V-DASH-04: Dashboard Recent Executions
 *
 * Main Purpose: Recent Executions section displays execution cards with all variations.
 *
 * Design Decisions: DASH-4
 * - DASH-4: Execution cards show status indicator, breadcrumb name, status info, progress bar
 *
 * Pass Criteria:
 * 1. "Recent Executions" section header visible
 * 2. 10 execution cards covering all variations
 * 3. Entity types: Test, Suite, Regression all present
 * 4. Statuses: Running, Passed, Failed all present
 * 5. Breadcrumb name format: Type > Name > Environment
 * 6. Test executions: Status + time (no "tests done")
 * 7. Suite/Regression: Status + "X/Y tests done"
 *    - Y = tests the user selected to run (from `selected_tests` or, for
 *      synthetic fixtures, the stored `tests_selected` field)
 *    - X = tests that reached a terminal state, derived from the stored
 *      progress percentage for synthetic fixtures
 * 8. Running executions show percentage
 * 9. Progress updates reflected after reload
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'

// Expected executions from v-dash-04/01-seed.sh. Per REQ-3.2.2.17, suite and
// regression cards show "X/Y tests done" where Y is the user's selection
// (the fixture's `tests_selected` arg) and X = round(Y * progress / 100) for
// synthetic fixtures that have no runtime state.
//
// Format: { name: breadcrumb, statusPattern: regex for status info }
const EXPECTED_EXECUTIONS = [
  // Test executions (no "tests done" fragment - single-test runs hide it)
  {
    name: 'Test > API Health Check > Default',
    status: 'running',
    statusPattern: /^Running · \d+% · \d+/,
    noTestsSelected: true,
  },
  {
    name: 'Test > Login Flow Test > Default',
    status: 'passed',
    statusPattern: /^Passed · /,
    noTestsSelected: true,
  },
  {
    name: 'Test > TLS Certificate Validation > Default',
    status: 'failed',
    statusPattern: /^Failed · /,
    noTestsSelected: true,
  },
  // Suite executions: Y = tests_selected, X = round(Y * progress / 100).
  // This row intentionally uses a long-decimal progress (33.33333333) in
  // the fixture to exercise the 2-decimal rounding path - the UI must
  // display "33.33%", not "33.333333...".
  {
    // progress=33.33 (rounded), selected=20 -> X = round(0.3333 * 20) = 7
    name: 'Suite > Health Checks > Default',
    status: 'running',
    statusPattern: /^Running · 33\.33% · .+ · 7\/20 tests done$/,
    hasTestsSelected: true,
  },
  {
    // progress=100, selected=15 -> X = 15
    name: 'Suite > TLS Validation > Default',
    status: 'passed',
    statusPattern: /^Passed · .+ · 15\/15 tests done$/,
    hasTestsSelected: true,
  },
  {
    // progress=80, selected=30 -> X = round(0.80 * 30) = 24
    name: 'Suite > GUI Smoke Tests > Default',
    status: 'failed',
    statusPattern: /^Failed · .+ · 24\/30 tests done$/,
    hasTestsSelected: true,
  },
  // Regression executions
  {
    // progress=25, selected=120 -> X = round(0.25 * 120) = 30
    name: 'Regression > WAVE 25.12 > Default',
    status: 'running',
    statusPattern: /^Running · \d+% · .+ · 30\/120 tests done$/,
    hasTestsSelected: true,
  },
  {
    // progress=100, selected=200 -> X = 200
    name: 'Regression > v2.0.0 Release > Default',
    status: 'passed',
    statusPattern: /^Passed · .+ · 200\/200 tests done$/,
    hasTestsSelected: true,
  },
  {
    // progress=50, selected=40 -> X = round(0.50 * 40) = 20
    name: 'Regression > Hotfix 2.0.1 > Default',
    status: 'failed',
    statusPattern: /^Failed · .+ · 20\/40 tests done$/,
    hasTestsSelected: true,
  },
  // Progress test execution (suite used by S7 to test progress updates).
  // Initial state: progress=25, selected=10 -> X = round(0.25 * 10) = 2
  // (Python's banker's rounding: 2.5 -> 2, so the backend returns 2.)
  {
    name: 'Suite > Progress Test Suite > Default',
    status: 'running',
    statusPattern: /^Running · \d+% · .+ · 2\/10 tests done$/,
    hasTestsSelected: true,
    isProgressTest: true,
  },
]

const EXPECTED_TOTAL = 10

test.describe('V-DASH-04: Dashboard Recent Executions', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/scripts/reset.sh')
    exec('./tests/e2e/fixtures/dashboard/v-dash-04/01-seed.sh')
  })

  test('V-DASH-04: Recent Executions section with 10 cards', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // Recent Executions section should be visible
    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(
      recentExecutionsSection,
      'Recent Executions section should be visible'
    ).toBeVisible()

    // Section header
    await expect(
      recentExecutionsSection.getByRole('heading', { name: 'Recent Executions' }),
      'Recent Executions header should be visible'
    ).toBeVisible()

    // Exactly 10 execution cards
    const executionCards = recentExecutionsSection.locator(
      '[data-testid="execution-card"]'
    )
    await expect(executionCards, 'Should have exactly 10 execution cards').toHaveCount(EXPECTED_TOTAL)

    // Each execution card should have: status indicator, name, status info
    const firstCard = executionCards.first()

    const statusIndicator = firstCard.locator(
      '[data-testid="execution-status-indicator"]'
    )
    await expect(statusIndicator, 'Should have status indicator').toBeVisible()

    const execName = firstCard.locator('[data-testid="execution-name"]')
    await expect(execName, 'Should have name').toBeVisible()

    const statusInfo = firstCard.locator('[data-testid="execution-status-info"]')
    await expect(statusInfo, 'Should have status info').toBeVisible()
  })

  test('V-DASH-04-S1: all 3 test executions present with exact status info', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    const testExecutions = EXPECTED_EXECUTIONS.filter(e => e.name.startsWith('Test >'))

    for (const expected of testExecutions) {
      const card = recentExecutionsSection.locator(
        '[data-testid="execution-card"]',
        { hasText: expected.name }
      )
      await expect(card, `Card "${expected.name}" should be present`).toBeVisible()

      // Verify status info matches expected pattern
      const statusInfo = card.locator('[data-testid="execution-status-info"]')
      const infoText = await statusInfo.textContent()

      expect(
        infoText,
        `Test execution "${expected.name}" should match pattern ${expected.statusPattern}`
      ).toMatch(expected.statusPattern)

      // Test executions should NOT contain "tests done"
      expect(
        infoText,
        `Test execution "${expected.name}" should NOT show "tests done"`
      ).not.toContain('tests done')
    }
  })

  test('V-DASH-04-S2: all 4 suite executions present with exact status info', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    const suiteExecutions = EXPECTED_EXECUTIONS.filter(e => e.name.startsWith('Suite >'))

    for (const expected of suiteExecutions) {
      const card = recentExecutionsSection.locator(
        '[data-testid="execution-card"]',
        { hasText: expected.name }
      )
      await expect(card, `Card "${expected.name}" should be present`).toBeVisible()

      // Verify status info matches expected pattern exactly
      const statusInfo = card.locator('[data-testid="execution-status-info"]')
      const infoText = await statusInfo.textContent()

      expect(
        infoText,
        `Suite execution "${expected.name}" should match pattern ${expected.statusPattern}`
      ).toMatch(expected.statusPattern)
    }
  })

  test('V-DASH-04-S3: all 3 regression executions present with exact status info', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    const regressionExecutions = EXPECTED_EXECUTIONS.filter(e => e.name.startsWith('Regression >'))

    for (const expected of regressionExecutions) {
      const card = recentExecutionsSection.locator(
        '[data-testid="execution-card"]',
        { hasText: expected.name }
      )
      await expect(card, `Card "${expected.name}" should be present`).toBeVisible()

      // Verify status info matches expected pattern exactly
      const statusInfo = card.locator('[data-testid="execution-status-info"]')
      const infoText = await statusInfo.textContent()

      expect(
        infoText,
        `Regression execution "${expected.name}" should match pattern ${expected.statusPattern}`
      ).toMatch(expected.statusPattern)
    }
  })

  test('V-DASH-04-S4: running executions show exact percentage and status', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    const runningExecutions = EXPECTED_EXECUTIONS.filter(e => e.status === 'running')

    for (const expected of runningExecutions) {
      const card = recentExecutionsSection.locator(
        '[data-testid="execution-card"]',
        { hasText: expected.name }
      )
      await expect(card, `Running card "${expected.name}" should be present`).toBeVisible()

      const statusInfo = card.locator('[data-testid="execution-status-info"]')
      const infoText = await statusInfo.textContent()

      expect(
        infoText,
        `Running execution "${expected.name}" should match pattern ${expected.statusPattern}`
      ).toMatch(expected.statusPattern)

      // Rounding invariant: the percentage token must carry at most 2
      // decimals. No long-float leaks like
      // "33.33333333%" coming through from the backend.
      const pctMatch = /(\d+(?:\.\d+)?)%/.exec(infoText ?? '')
      expect(
        pctMatch,
        `Running card "${expected.name}" must render a percentage token`
      ).not.toBeNull()
      const decimals = pctMatch![1].split('.')[1] ?? ''
      expect(
        decimals.length,
        `Percentage "${pctMatch![0]}" on "${expected.name}" must have at most 2 decimals`
      ).toBeLessThanOrEqual(2)
    }
  })

  test('V-DASH-04-S5: passed executions present with exact status info', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    const passedExecutions = EXPECTED_EXECUTIONS.filter(e => e.status === 'passed')

    for (const expected of passedExecutions) {
      const card = recentExecutionsSection.locator(
        '[data-testid="execution-card"]',
        { hasText: expected.name }
      )
      await expect(card, `Passed card "${expected.name}" should be present`).toBeVisible()

      const statusInfo = card.locator('[data-testid="execution-status-info"]')
      const infoText = await statusInfo.textContent()

      expect(
        infoText,
        `Passed execution "${expected.name}" should match pattern ${expected.statusPattern}`
      ).toMatch(expected.statusPattern)
    }
  })

  test('V-DASH-04-S6: failed executions present with exact status info', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    const failedExecutions = EXPECTED_EXECUTIONS.filter(e => e.status === 'failed')

    for (const expected of failedExecutions) {
      const card = recentExecutionsSection.locator(
        '[data-testid="execution-card"]',
        { hasText: expected.name }
      )
      await expect(card, `Failed card "${expected.name}" should be present`).toBeVisible()

      const statusInfo = card.locator('[data-testid="execution-status-info"]')
      const infoText = await statusInfo.textContent()

      expect(
        infoText,
        `Failed execution "${expected.name}" should match pattern ${expected.statusPattern}`
      ).toMatch(expected.statusPattern)
    }
  })

  test('V-DASH-04-S7: progress updates reflected after reload', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const recentExecutionsSection = page.locator(
      '[data-testid="recent-executions-section"]'
    )
    await expect(recentExecutionsSection).toBeVisible()

    // Find the progress test execution card (Suite > Progress Test Suite)
    const progressCard = recentExecutionsSection.locator(
      '[data-testid="execution-card"]',
      { hasText: 'Suite > Progress Test Suite' }
    )
    await expect(progressCard, 'Progress test card should be present').toBeVisible()

    // Update execution to 75%
    exec('./tests/e2e/fixtures/dashboard/v-dash-04/02-update.sh ac1f4f5d-ebec-4707-97ec-a2a03523d4c3 75 running')

    // Reload page
    await page.reload()
    await waitForDashboardLoad(page)

    // Verify progress updated to 75%
    const statusInfo = progressCard.locator('[data-testid="execution-status-info"]')
    await expect(statusInfo, 'Should show 75% progress after update').toContainText('75%')

    // Update to passed
    exec('./tests/e2e/fixtures/dashboard/v-dash-04/02-update.sh ac1f4f5d-ebec-4707-97ec-a2a03523d4c3 100 passed')

    // Reload and verify passed status
    await page.reload()
    await waitForDashboardLoad(page)

    // Verify passed status with 10/10 tests done
    await expect(statusInfo, 'Should show Passed status after completion').toContainText('Passed')
    await expect(statusInfo, 'Should show 10/10 tests done').toContainText('10/10 tests done')
  })
})
