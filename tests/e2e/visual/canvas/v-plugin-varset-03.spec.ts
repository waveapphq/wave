/**
 * V-PLUGIN-VARSET-03: Variable Setter live runtime values surface in the panel
 *
 * Phase: fixture (serial) - requires seeded test with pre-configured Variable Setter
 * REQ: REQ-3.4.1.14 Variable Setter Control, REQ-3.1.3.12 Auto-refresh on change
 *
 * The Variable Manager panel is a flat list and runtime values stream into
 * the same row that shows the definition, so the assertion target is the
 * row's value cell directly.
 *
 * Integration seam covered:
 *   - VariablePushService._wrap_envelope() (backend WebSocket push)
 *   - WebSocket client dispatch (type: "event" routing)
 *   - useVariableUpdates handler registration via registerVariableHandler
 *   - displayVariables overlay in workbench-container.tsx
 *
 * Pass Criteria:
 * 1. Variables appear in the Variable Manager with their definition values
 *    before the run.
 * 2. After the workflow runs, the same row updates to show the runtime value:
 *    "watch_str" goes from "original" to "updated by setter", "watch_int" goes
 *    from 0 to 99.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { exec } from '../../helpers/exec'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_ID = 'a0030e00-0001-0001-0001-000000000001'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Load the seeded test workflow in the workbench. */
async function loadTestWorkflow(page: Page) {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session`)
    .catch(() => {})

  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${TEST_ID}`)
  await waitForCanvasLoad(page)
}

/** Expand the Variable Manager panel if collapsed. */
async function expandVariableManager(page: Page) {
  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

/** Locate the row for a variable by name. */
function findVariableRow(page: Page, varName: string): Locator {
  return page.locator(`[aria-label="Variable ${varName}"]`)
}

/** Locate the value cell of a variable row. */
function getVariableValue(page: Page, varName: string): Locator {
  return findVariableRow(page, varName).locator('[data-testid^="variable-value-"]')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-PLUGIN-VARSET-03: Variable Setter live runtime values', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/canvas/v-plugin-varset-03/01-seed.sh')
  })

  test('runtime values stream into the panel rows when the Variable Setter executes', async ({
    page,
  }) => {
    await loadTestWorkflow(page)
    await expandVariableManager(page)

    // ================================================================
    // Step 1: Verify definition values are shown before the run
    // ================================================================
    const strRow = findVariableRow(page, 'watch_str')
    await expect(strRow).toBeVisible({ timeout: 5_000 })

    const intRow = findVariableRow(page, 'watch_int')
    await expect(intRow).toBeVisible()

    await expect(getVariableValue(page, 'watch_str')).toContainText('original')
    await expect(getVariableValue(page, 'watch_int')).toContainText('0')

    // ================================================================
    // Step 2: Select environment, run the workflow
    // ================================================================
    const envSelector = page.locator('[data-testid="environment-selector"]')
    await envSelector.click()
    const envPopover = page.locator('[data-testid="environment-popover"]')
    await expect(envPopover).toBeVisible()
    await envPopover.locator('button:has-text("Test Env")').first().click()
    await expect(envPopover).not.toBeVisible()

    const runButton = page.locator('[data-testid="run-button"]')
    await runButton.click()

    const statusIndicator = page.locator('[data-testid="workflow-status"]')
    await expect(statusIndicator).toHaveAttribute('data-status', 'passed', {
      timeout: 30_000,
    })

    // ================================================================
    // Step 3: Same rows now show the runtime values
    // ================================================================
    await expect(getVariableValue(page, 'watch_str')).toContainText('updated by setter', {
      timeout: 5_000,
    })
    await expect(getVariableValue(page, 'watch_int')).toContainText('99', { timeout: 5_000 })
  })
})
