/**
 * V-DASH-TEST-SUITE-COUNT: Recent Activity test entries show suite count
 *
 * A test entry in Recent Activity shows its suite count:
 *   - 0 suites  -> "Unassigned"
 *   - 1 suite   -> "1 suite"
 *   - 2+ suites -> "N suites"
 *
 * Reuses the v-dash-02 seed because it already has the right shape: tests
 * assigned to exactly one suite (e.g. "API Health Check" -> "Health Checks")
 * AND unassigned tests ("Login Flow Test", "OpenSearch Index Rotation").
 *
 * Pass Criteria:
 *   S1 An assigned test row's context contains "1 suite" (and never "Unassigned").
 *   S2 An unassigned test row's context contains "Unassigned".
 *   S3 The suite row context still says "N tests", and the suite/regression
 *      formatting holds.
 */

import { test, expect, type Locator } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'

async function findActivityRowByName(section: Locator, name: string): Promise<Locator> {
  // Match by exact activity-name text and walk up to the activity-item ancestor.
  const nameLocator = section
    .locator('[data-testid="activity-name"]')
    .filter({ hasText: new RegExp(`^${name}$`) })
  await expect(
    nameLocator,
    `Activity row with name "${name}" should be present`,
  ).toHaveCount(1)
  return nameLocator.locator('xpath=ancestor::*[@data-testid="activity-item"][1]')
}

async function contextOf(row: Locator): Promise<string> {
  const ctx = row.locator('[data-testid="activity-context"]')
  await expect(ctx).toBeVisible()
  return ((await ctx.textContent()) ?? '').trim()
}

test.describe('V-DASH-TEST-SUITE-COUNT: Recent Activity test entries show suite count', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/dashboard/v-dash-02/01-seed.sh')
  })

  test('S1: assigned test renders "Test · 1 suite · ..."', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const section = page.locator('[data-testid="recent-activity-section"]')
    // "API Health Check" is in suite "Health Checks" only - exactly 1 suite.
    const row = await findActivityRowByName(section, 'API Health Check')
    const ctx = await contextOf(row)

    expect(ctx, `context: "${ctx}"`).toMatch(/^Test\s·\s1 suite\s·/)
    expect(
      ctx,
      'assigned test must NOT show Unassigned (the bug regression)',
    ).not.toContain('Unassigned')
    // Singular form, not "1 suites".
    expect(ctx).not.toMatch(/\b1 suites\b/)
  })

  test('S2: unassigned test renders "Test · Unassigned · ..."', async ({ page }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const section = page.locator('[data-testid="recent-activity-section"]')
    // "Login Flow Test" was created without a parent suite in v-dash-02.
    const row = await findActivityRowByName(section, 'Login Flow Test')
    const ctx = await contextOf(row)

    expect(ctx, `context: "${ctx}"`).toMatch(/^Test\s·\sUnassigned\s·/)
  })

  test('S3: suite row still shows "N tests" (no regression to suite/regression formatting)', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const section = page.locator('[data-testid="recent-activity-section"]')
    // "Health Checks" suite has exactly 1 test ("API Health Check") in v-dash-02.
    const row = await findActivityRowByName(section, 'Health Checks')
    const ctx = await contextOf(row)

    expect(ctx, `context: "${ctx}"`).toMatch(/^Suite\s·\s1 test\s·/)
  })
})
