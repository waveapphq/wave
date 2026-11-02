/**
 * V-DASH-ACTIVITY-DISPLAY-ONLY-01: Dashboard Recent Activity is non-interactive
 *
 * REQ: REQ-3.2.2.17
 * Surface: Dashboard Recent Activity section + Recent Executions sanity check.
 *
 * Pass Criteria:
 *   1. Recent Activity rows render as a non-interactive feed:
 *        - no `cursor-pointer` class
 *        - no hover background shift class
 *        - no `role="button"`
 *        - no `tabindex` attribute
 *      Clicking a row does not navigate anywhere.
 *   2. The neighboring Recent Executions card stays interactive: clicking
 *      a card row navigates to /executions/{id}.
 *
 * Reuses the v-dash-02 seed (5 tests, 4 suites, 2 regressions, 4 recent
 * executions) - that fixture is the smallest seed that populates both
 * the Recent Activity feed and the Recent Executions card on its own.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForDashboardLoad } from '../../helpers/dashboard'

test.describe('V-DASH-ACTIVITY-DISPLAY-ONLY-01: Recent Activity is display-only', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/dashboard/v-dash-02/01-seed.sh')
  })

  test('S1: Recent Activity rows have no interactive affordances and clicking does not navigate', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const section = page.locator('[data-testid="recent-activity-section"]')
    await expect(section, 'Recent Activity section should be visible').toBeVisible()

    const items = section.locator('[data-testid="activity-item"]')
    const itemCount = await items.count()
    expect(itemCount, 'Recent Activity should render at least one item').toBeGreaterThan(0)

    // Inspect every row, not just the first - we want the assertion to fail
    // if even one row turns interactive (display-only contract).
    for (let i = 0; i < itemCount; i++) {
      const item = items.nth(i)

      const role = await item.getAttribute('role')
      expect(role, `Activity row ${i} must not have role="button"`).not.toBe('button')

      const tabindex = await item.getAttribute('tabindex')
      expect(
        tabindex,
        `Activity row ${i} must not have a tabindex attribute (was ${String(tabindex)})`,
      ).toBeNull()

      const className = (await item.getAttribute('class')) ?? ''
      expect(
        className.includes('cursor-pointer'),
        `Activity row ${i} must not carry cursor-pointer (class="${className}")`,
      ).toBe(false)
      expect(
        className.includes('hover:bg-subtle'),
        `Activity row ${i} must not carry hover:bg-subtle (class="${className}")`,
      ).toBe(false)
    }

    const urlBefore = page.url()
    await items.first().click()
    // The page must not navigate. Give it a moment to settle so a delayed
    // navigation would have time to fire if one were wired.
    await page.waitForTimeout(300)
    expect(
      page.url(),
      'Clicking a Recent Activity row must not change the URL',
    ).toBe(urlBefore)
  })

  test('S2: Recent Executions card remains clickable and navigates to /executions/{id}', async ({
    page,
  }) => {
    await page.goto('/dashboard')
    await waitForDashboardLoad(page)

    const card = page.locator('[data-testid="execution-card"]').first()
    await expect(card, 'Recent Executions card should be visible').toBeVisible()

    await card.click()
    await page.waitForURL(/\/executions\/[0-9a-f-]{36}/, { timeout: 5000 })
    expect(page.url(), 'Clicking a Recent Executions card must navigate to its detail page').toMatch(
      /\/executions\/[0-9a-f-]{36}$/,
    )
  })
})
