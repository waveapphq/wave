/**
 * Execution Detail Components table row actions.
 *
 * A regression where the same test_id appears in two suites produces
 * two rows with DIFFERENT run_ids. Clicking View on each opens a
 * distinct /executions/history/<runId> URL.
 * Excluded test rows (selected_tests omitted -> no run_id) hide the
 * View (eye) button per TestActions.
 *
 * Fixture: `v-exec-duplicate-test` seeds a regression execution whose
 * `suites[]` payload carries the nested tests tree with explicit run_ids
 * (RUN_AUTH, RUN_ADMIN) plus one excluded test in the Admin Suite.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const EXEC_ID = 'd0000061-0000-0000-0000-000000000061'
const RUN_AUTH = 'd0000061-0001-0001-0001-aa00000000aa'
const RUN_ADMIN = 'd0000061-0002-0002-0002-bb00000000bb'

test.describe('regression Components table uses run_id for View', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-duplicate-test/01-seed.sh')
  })

  async function openDetailAndExpand(page: import('@playwright/test').Page): Promise<void> {
    await page.goto(`/executions/${EXEC_ID}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    // Regression table is collapsed per suite by default. Expand both so
    // all test rows are visible.
    const authExpander = page.getByRole('button', { name: /expand.*auth suite|auth suite/i }).first()
    if ((await authExpander.count()) > 0) {
      await authExpander.click().catch(() => undefined)
    }
    const adminExpander = page.getByRole('button', { name: /expand.*admin suite|admin suite/i }).first()
    if ((await adminExpander.count()) > 0) {
      await adminExpander.click().catch(() => undefined)
    }
  }

  test('duplicate test across suites opens two distinct history pages', async ({
    page,
    context,
  }) => {
    await openDetailAndExpand(page)

    // Two "Open test detail" links should exist (one per suite that
    // carries Login Smoke). Each should point to a distinct run_id.
    const eyeLinks = page.getByRole('link', { name: /open test detail/i })
    await expect(eyeLinks, 'two open-detail eye links for the duplicate test').toHaveCount(2)

    const href1 = await eyeLinks.nth(0).getAttribute('href')
    const href2 = await eyeLinks.nth(1).getAttribute('href')

    expect(href1, 'first link present').toBeTruthy()
    expect(href2, 'second link present').toBeTruthy()
    expect(href1, 'two links point to different URLs').not.toEqual(href2)

    // Both URLs use /executions/history/<runId>.
    expect(href1).toMatch(/\/executions\/history\/[0-9a-f-]+$/)
    expect(href2).toMatch(/\/executions\/history\/[0-9a-f-]+$/)

    // The two run_ids should be the seeded ones (order is DOM order, but
    // we just assert both are present across the pair).
    const targets = new Set([href1, href2])
    expect(targets).toContain(`/executions/history/${RUN_AUTH}`)
    expect(targets).toContain(`/executions/history/${RUN_ADMIN}`)

    // Navigate into one; the history canvas mounts.
    await eyeLinks.nth(0).click()
    await expect(page.locator('[data-testid="workbench-page"]')).toBeVisible({ timeout: 10_000 })
    await expect(page).toHaveURL(/\/executions\/history\/[0-9a-f-]+$/)

    // Open the other target in a fresh page so we don't fight history;
    // assert it resolves to a different URL than the first.
    const pageB = await context.newPage()
    await pageB.goto(String(href2))
    await expect(pageB.locator('[data-testid="workbench-page"]')).toBeVisible({ timeout: 10_000 })
    await expect(pageB).toHaveURL(new RegExp(`/executions/history/${RUN_ADMIN}$`))
    await pageB.close()
  })

  test('excluded test row hides the View button', async ({ page }) => {
    await openDetailAndExpand(page)

    // Find the row for "Admin-only Check" (excluded). The row should
    // render in the Admin Suite but without an eye-icon link because it
    // has no run_id.
    const excludedRow = page.getByRole('row', { name: /admin-only check/i }).first()
    await expect(excludedRow, 'excluded test row is rendered').toBeVisible()
    await expect(
      excludedRow.getByRole('link', { name: /open test detail/i }),
      'excluded row has no View eye link',
    ).toHaveCount(0)
  })
})
