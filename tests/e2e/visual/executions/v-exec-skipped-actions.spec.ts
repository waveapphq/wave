/**
 * V-EXEC-SKIPPED-ACTIONS: skipped executions expose Re-run + Delete
 * (execution list row actions consistency)
 *
 * The canonical terminal set is {passed, failed, stopped, skipped} (`isTerminalStatus`).
 * A `skipped` execution row must therefore expose View + Re-run + Delete (not View only),
 * consistent with passed/failed/stopped and with the detail toolbar.
 *
 * Pass Criteria:
 *  1. The seeded `skipped` regression execution row renders View, Re-run, and
 *     Delete row actions.
 *  2. It does NOT render the Stop action (Stop is running-only).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const SKIPPED_EXECUTION_NAME = 'Halt Regression'

test.describe('V-EXEC-SKIPPED-ACTIONS: skipped row exposes Re-run + Delete', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-skipped/01-seed.sh')
  })

  test('skipped execution row has View + Re-run + Delete, no Stop', async ({ page }) => {
    await page.goto('/executions')
    await expect(page.getByTestId('executions-page')).toBeVisible()

    const row = page
      .locator('[data-testid="executions-table"] tbody tr')
      .filter({ hasText: SKIPPED_EXECUTION_NAME })
    await expect(row.first()).toBeVisible()

    // Terminal-status row actions: View + Re-run + Delete are all present.
    await expect(
      row.first().locator('[data-testid="row-action-view"]'),
      'skipped row still exposes View',
    ).toBeVisible()
    await expect(
      row.first().locator('[data-testid="row-action-rerun"]'),
      'skipped is terminal -> Re-run is offered',
    ).toBeVisible()
    await expect(
      row.first().locator('[data-testid="row-action-delete"]'),
      'skipped is terminal -> Delete is offered',
    ).toBeVisible()
    // Stop is a running-only action.
    await expect(row.first().locator('[data-testid="row-action-stop"]')).toHaveCount(0)
  })
})
