/**
 * V-EXEC-HISTORY-01
 *
 * Historical Test Canvas for a seeded test-type execution.
 *
 * For a test-type execution `/executions/<id>` redirects to
 * `/executions/history/<id>`, which renders no Components table. This
 * file asserts the history canvas layout:
 *
 *  1. Page mounts in history mode (`workbench-page`, data-mode=history).
 *  2. Action-bar shows the environment label pill (disabled) and the
 *     "Open in Workbench" button.
 *  3. Palette is rendered collapsed and disabled.
 *  4. Console panel is visible with Clear disabled.
 *  5. Variable manager panel is visible.
 *  6. The Log node from the seeded workflow_snapshot paints.
 *
 * Fixture: `v-exec-test-01/01-seed.sh` (seeds `workflow_snapshot` +
 * `run_id == id`).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const EXEC_ID = 'd0000003-0000-0000-0000-000000000003'

test.describe('V-EXEC-HISTORY-01: Historical Test Canvas for a test-type execution', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/executions/v-exec-test-01/01-seed.sh')
  })

  async function gotoHistory(page: import('@playwright/test').Page) {
    await page.goto(`/executions/history/${EXEC_ID}`)
    await page.waitForSelector('[data-testid="workbench-page"]', { state: 'visible' })
  }

  test('V-EXEC-HISTORY-01-S1: mounts in history mode', async ({ page }) => {
    await gotoHistory(page)
    await expect(page.locator('[data-testid="workbench-page"]')).toHaveAttribute(
      'data-mode',
      'history',
    )
    await expect(page.locator('[data-testid="canvas-main-content"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-canvas"]')).toBeVisible()
  })

  test('V-EXEC-HISTORY-01-S2: action bar exposes env label + Open in Workbench', async ({
    page,
  }) => {
    await gotoHistory(page)
    const envSelector = page.locator('[data-testid="environment-selector"]')
    await expect(envSelector, 'env label pill visible').toBeVisible()
    await expect(envSelector, 'env label pill is disabled on history').toBeDisabled()
    await expect(envSelector, 'env label shows "Local"').toContainText(/local/i)
    await expect(
      page.locator('[data-testid="open-in-workbench-button"]'),
      'Open in Workbench button visible',
    ).toBeVisible()
  })

  test('V-EXEC-HISTORY-01-S3: palette is collapsed + disabled', async ({ page }) => {
    await gotoHistory(page)
    const palette = page.locator('[data-testid="block-palette"]')
    await expect(palette).toBeVisible()
    await expect(palette).toHaveAttribute('data-state', 'collapsed')
    await expect(palette).toHaveAttribute('data-disabled', 'true')
    await expect(palette).toHaveAttribute('aria-disabled', 'true')
  })

  test('V-EXEC-HISTORY-01-S4: console visible with Clear disabled', async ({ page }) => {
    await gotoHistory(page)
    const consolePanel = page.locator('[data-testid="console-panel"]')
    await expect(consolePanel).toBeVisible()
    const clearBtn = consolePanel.getByRole('button', { name: /clear console/i })
    await expect(clearBtn, 'Clear is disabled in history mode').toBeDisabled()
  })

  test('V-EXEC-HISTORY-01-S5: variable manager panel is visible', async ({ page }) => {
    await gotoHistory(page)
    await expect(page.locator('[data-testid="variable-manager"]')).toBeVisible()
  })

  test('V-EXEC-HISTORY-01-S6: workflow_snapshot paints the Log node', async ({ page }) => {
    await gotoHistory(page)
    // React Flow mounts nodes with their ids in the DOM node's data
    // attribute. Any of these locators resolving confirms the snapshot
    // painted.
    const node = page.locator('[data-id="log-hist"], [data-testid*="log-hist"]').first()
    await expect(node, 'log-hist node from the snapshot is visible on the canvas').toBeVisible()
  })
})
