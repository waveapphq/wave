/**
 * V-DASH-02: Dashboard Metric Cards
 *
 * Main Purpose: Dashboard displays 4 metric cards with correct counts and layout.
 *
 * Design Decisions: DASH-1
 * - DASH-1: Four summary cards: Tests, Suites, Regressions, Executions (24h)
 *
 * Pass Criteria:
 * 1. Page title: "Dashboard"
 * 2. 4 metric cards in horizontal row: Tests, Suites, Regressions, Executions (24h)
 * 3. Tests/Suites/Regressions show count only (no subtitle)
 * 4. Executions (24h) shows count + running/passed/failed subtitle
 * 5. Old executions (>24h) excluded from metrics count
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'

test.describe('V-DASH-02: Dashboard Metric Cards', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/dashboard/v-dash-02/01-seed.sh')
  })

  test('V-DASH-02: metric cards display with correct layout', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // 1. Page title: "Dashboard"
    const pageTitle = page.getByRole('heading', { name: 'Dashboard', level: 1 })
    await expect(pageTitle, 'Page title should be "Dashboard"').toBeVisible()

    // 2. 4 metric cards in row per DASH-1
    // Tests card: count only (no subtitle)
    const testsCard = page.locator('[data-testid="metric-card-tests"]')
    await expect(testsCard, 'Tests metric card should be visible').toBeVisible()
    await expect(
      testsCard.getByText('Tests'),
      'Tests card should have "Tests" label'
    ).toBeVisible()
    const testsCount = testsCard.locator('[data-testid="metric-count"]')
    await expect(testsCount, 'Tests count should show 5').toHaveText('5')
    // Tests card should NOT have subtitle (simplified metrics)
    const testsSubtitle = testsCard.locator('[data-testid="metric-subtitle"]')
    await expect(testsSubtitle, 'Tests card should have no subtitle').toHaveCount(0)

    // Suites card: count only (no subtitle)
    const suitesCard = page.locator('[data-testid="metric-card-suites"]')
    await expect(
      suitesCard,
      'Suites metric card should be visible'
    ).toBeVisible()
    await expect(
      suitesCard.getByText('Suites'),
      'Suites card should have "Suites" label'
    ).toBeVisible()
    const suitesCount = suitesCard.locator('[data-testid="metric-count"]')
    await expect(suitesCount, 'Suites count should show 4').toHaveText('4')
    const suitesSubtitle = suitesCard.locator('[data-testid="metric-subtitle"]')
    await expect(suitesSubtitle, 'Suites card should have no subtitle').toHaveCount(0)

    // Regressions card: count only (no subtitle)
    const regressionsCard = page.locator(
      '[data-testid="metric-card-regressions"]'
    )
    await expect(
      regressionsCard,
      'Regressions metric card should be visible'
    ).toBeVisible()
    await expect(
      regressionsCard.getByText('Regressions'),
      'Regressions card should have "Regressions" label'
    ).toBeVisible()
    const regressionsCount = regressionsCard.locator(
      '[data-testid="metric-count"]'
    )
    await expect(
      regressionsCount,
      'Regressions count should show 2'
    ).toHaveText('2')
    const regressionsSubtitle = regressionsCard.locator(
      '[data-testid="metric-subtitle"]'
    )
    await expect(regressionsSubtitle, 'Regressions card should have no subtitle').toHaveCount(0)

    // Executions (24h) card: count + running/passed/failed subtitle (inline)
    const executionsCard = page.locator(
      '[data-testid="metric-card-executions"]'
    )
    await expect(
      executionsCard,
      'Executions metric card should be visible'
    ).toBeVisible()
    await expect(
      executionsCard.getByText(/Executions.*24h/i),
      'Executions card should have "Executions (24h)" label'
    ).toBeVisible()
    const executionsCount = executionsCard.locator(
      '[data-testid="metric-count"]'
    )
    await expect(
      executionsCount,
      'Executions count should show 4'
    ).toHaveText('4')
    // Only executions card has subtitle with running/passed/failed
    const executionsSubtitle = executionsCard.locator(
      '[data-testid="metric-subtitle"]'
    )
    await expect(
      executionsSubtitle,
      'Executions subtitle should be visible'
    ).toBeVisible()
    await expect(executionsSubtitle).toContainText(/running|passed|failed/i)

    // Verify metric cards are in a row (horizontal layout)
    const testsBox = await testsCard.boundingBox()
    const suitesBox = await suitesCard.boundingBox()
    const regressionsBox = await regressionsCard.boundingBox()
    const executionsBox = await executionsCard.boundingBox()

    expect(testsBox !== null && suitesBox !== null, 'Tests and Suites cards must have bounds').toBe(true)
    // All cards should be on roughly the same Y position (same row)
    expect(
      Math.abs(testsBox!.y - suitesBox!.y) < 10,
      'Tests and Suites cards should be in the same row'
    ).toBe(true)
    expect(
      Math.abs(suitesBox!.y - regressionsBox!.y) < 10,
      'Suites and Regressions cards should be in the same row'
    ).toBe(true)
    expect(
      Math.abs(regressionsBox!.y - executionsBox!.y) < 10,
      'Regressions and Executions cards should be in the same row'
    ).toBe(true)

    // Cards should be in left-to-right order
    expect(
      testsBox!.x < suitesBox!.x,
      'Tests card should be left of Suites card'
    ).toBe(true)
    expect(
      suitesBox!.x < regressionsBox!.x,
      'Suites card should be left of Regressions card'
    ).toBe(true)
    expect(
      regressionsBox!.x < executionsBox!.x,
      'Regressions card should be left of Executions card'
    ).toBe(true)
  })

  test('V-DASH-02-S1: old execution excluded from 24h metrics', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    // The v-dash-02 fixture includes 5 executions:
    // - 4 from December 28, 2025 (within 24h)
    // - 1 from December 26, 2025 (exec-old-passed, outside 24h window)
    //
    // The 24h executions count should only include the 4 recent executions

    // Verify the Executions (24h) card shows the correct count
    const executionsCard = page.locator('[data-testid="metric-card-executions"]')
    await expect(executionsCard, 'Executions card should be visible').toBeVisible()

    // The count should be 4 (not 5, since exec-old-passed is outside 24h window)
    const executionsCount = executionsCard.locator('[data-testid="metric-count"]')
    await expect(executionsCount).toHaveText('4')
  })
})
