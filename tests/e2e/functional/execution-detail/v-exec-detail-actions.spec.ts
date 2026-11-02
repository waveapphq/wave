/**
 * Execution Detail toolbar actions: Delete.
 *
 * Delete on a terminal execution uses the new `onDeleted` prop on
 *     ExecutionToolbar to navigate back to /executions and removes the
 *     row from the list.
 *
 * Fixtures reused:
 *   - v-exec-01 (suite-type) for Delete, so it has a non-test row to work
 *     on (test-type rows redirect to /executions/history before the
 *     toolbar renders).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const SUITE_EXEC_ID = 'd0000001-0000-0000-0000-000000000001'
const SUITE_EXEC_NAME = 'Authentication Suite'

test.describe('Delete navigates back to /executions and removes the row', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-01/01-seed.sh')
  })

  test('toolbar Delete -> list URL + deleted row not in list', async ({ page }) => {
    await page.goto(`/executions/${SUITE_EXEC_ID}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    // Open the toolbar's delete confirmation dialog. There can be
    // multiple "Delete" labels on the page (row-level Delete from the
    // Components table, etc.) - scope to the DetailHeader so we only
    // hit the toolbar.
    const header = page.locator('[data-testid="execution-detail-page"]').first()
    await header.getByRole('button', { name: /^delete$/i }).first().click()

    // The modal is an AlertDialog with the confirm button testid
    // `delete-confirm`. Prefer the testid over role/name so the scoped
    // lookup is deterministic.
    const confirm = page.locator('[data-testid="delete-confirm"]')
    await confirm.click()

    // onDeleted navigates back to the list.
    await expect(page).toHaveURL(/\/executions(\?.*)?$/)
    // The deleted row's name should not appear in the table.
    await expect(
      page.getByRole('cell', { name: SUITE_EXEC_NAME, exact: true }),
      'deleted execution no longer visible in list',
    ).toHaveCount(0)
  })
})
