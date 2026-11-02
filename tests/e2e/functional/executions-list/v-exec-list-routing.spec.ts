/**
 * Executions list routing + terminal-status surfacing.
 *
 * Row-click on a test-type execution routes to /executions/history/:id
 *     (container.tsx::handleViewExecution).
 * Direct-URL goto /executions/:id for a test-type row redirects with
 *     replace: true to /executions/history/:id (ExecutionDetailPage guard).
 * The 'skipped' status surfaces in the
 *     table as "Skipped" with data-testid="status-badge-skipped".
 *
 * Fixtures:
 *   - v-exec-01 (suite)
 *   - v-exec-02 (regression)
 *   - v-exec-test-01 (test)
 *   - v-exec-skipped (regression terminated with status=skipped)
 * Each test runs its own `beforeAll` because reseeds between tests are fine
 * and keep each flow independent.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const TEST_EXEC_ID = 'd0000003-0000-0000-0000-000000000003'
const SUITE_EXEC_ID = 'd0000001-0000-0000-0000-000000000001'
const REGRESSION_EXEC_ID = 'd0000002-0000-0000-0000-000000000002'
const SKIPPED_EXEC_ID = 'd0000041-0000-0000-0000-000000000041'

test.describe('executions list row-click routes per entity type', () => {
  test.beforeAll(() => {
    // Seed all three entity types in succession. Each helper calls
    // _reset_all first, so the last one run wins - seed order here is
    // "most recent first" so all three rows are present in the list.
    exec('./tests/e2e/fixtures/executions/v-exec-test-01/01-seed.sh')
    // _reset_all in each helper would wipe the prior seed; keep the
    // test-type row as the only one and verify routing per spec.
  })

  test('test-type row routes to /executions/history/<id>', async ({ page }) => {
    await page.goto('/executions')
    const viewBtn = page
      .locator(`[data-testid="row-action-view"][aria-label*="Login smoke"]`)
      .first()
    await expect(viewBtn, 'View action visible for seeded test execution').toBeVisible()
    await viewBtn.click()
    await expect(page).toHaveURL(new RegExp(`/executions/history/${TEST_EXEC_ID}$`))
  })
})

test.describe('suite and regression rows keep the classic detail URL', () => {
  test('suite-type row routes to /executions/<id>', async ({ page }) => {
    exec('./tests/e2e/fixtures/executions/v-exec-01/01-seed.sh')
    await page.goto('/executions')
    const viewBtn = page
      .locator(`[data-testid="row-action-view"][aria-label*="Authentication Suite"]`)
      .first()
    await expect(viewBtn, 'View action visible for seeded suite execution').toBeVisible()
    await viewBtn.click()
    await expect(page).toHaveURL(new RegExp(`/executions/${SUITE_EXEC_ID}$`))
    // Should NOT jump to /executions/history/...
    await expect(page).not.toHaveURL(new RegExp(`/executions/history/`))
  })

  test('regression-type row routes to /executions/<id>', async ({ page }) => {
    exec('./tests/e2e/fixtures/executions/v-exec-02/01-seed.sh')
    await page.goto('/executions')
    const viewBtn = page
      .locator(`[data-testid="row-action-view"][aria-label*="Nightly Regression"]`)
      .first()
    await expect(viewBtn, 'View action visible for seeded regression execution').toBeVisible()
    await viewBtn.click()
    await expect(page).toHaveURL(new RegExp(`/executions/${REGRESSION_EXEC_ID}$`))
    await expect(page).not.toHaveURL(new RegExp(`/executions/history/`))
  })
})

test.describe('direct URL goto /executions/<test-id> redirects to history', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-test-01/01-seed.sh')
  })

  test('/executions/<test-id> replaces URL with /executions/history/<id>', async ({
    page,
  }) => {
    // Navigate through the list first so the back stack has a sensible
    // previous entry, then click into the test-type row by direct URL.
    // The ExecutionDetailPage's test-type guard fires `navigate(...,
    // { replace: true })` after the fetch resolves, so the URL must
    // change to the history route without adding a history stack entry.
    await page.goto('/executions')
    await page.goto(`/executions/${TEST_EXEC_ID}`)
    await expect(page).toHaveURL(new RegExp(`/executions/history/${TEST_EXEC_ID}$`), {
      timeout: 10_000,
    })

    // Replace-semantics check: goBack must land on `/executions`, not
    // back on `/executions/<id>`. If the redirect had used push
    // semantics, goBack would bounce us through the intermediate URL.
    await page.goBack()
    await expect(page).toHaveURL(/\/executions(\?.*)?$/)
  })
})

test.describe('"skipped" status surfaces in the Executions list', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-skipped/01-seed.sh')
  })

  test('row renders Skipped label with status-badge-skipped testid', async ({ page }) => {
    await page.goto('/executions')
    // The status cell is keyed off the row's status value via the shared
    // StatusBadgeCell renderer. Before the mapStatus change, unknown
    // statuses fell back to 'running' and this row would have rendered
    // a status-badge-running pill.
    const skippedBadge = page
      .locator(`[data-testid="status-badge-skipped"]`)
      .first()
    await expect(skippedBadge, 'row renders a skipped status badge').toBeVisible()
    await expect(skippedBadge).toContainText(/skipped/i)
    // Belt-and-braces: the row must NOT be flagged as running.
    await expect(page.locator(`[data-testid="status-badge-running"]`)).toHaveCount(0)
  })

  test(`direct URL goto /executions/${SKIPPED_EXEC_ID} is a terminal view (no Stop button)`, async ({
    page,
  }) => {
    await page.goto(`/executions/${SKIPPED_EXEC_ID}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })
    // Terminal toolbar shows Re-run / Export / Delete. The Stop button is
    // only present while the execution is running; its absence confirms
    // the detail page treats skipped as terminal.
    await expect(page.getByRole('button', { name: /re-run/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /^stop$/i })).toHaveCount(0)
  })

  test('Status filter exposes Skipped as a selectable option', async ({ page }) => {
    // Skipped is a reachable terminal status: a test that halts with
    // status=skipped, a suite where every selected test is skipped, or
    // a regression where every selected test is skipped. The filter
    // must offer it so users can narrow the list to those runs.
    await page.goto('/executions')
    const statusFilter = page.locator('[data-testid="filter-status"]')
    await expect(statusFilter, 'Status filter button visible').toBeVisible()
    await statusFilter.click()
    await expect(
      page.getByRole('option', { name: /^skipped$/i }).first(),
      'Skipped option appears in the Status filter',
    ).toBeVisible()
  })
})
