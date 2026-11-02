/**
 * V-CANVAS-17: Paused Canvas - Console Amber Line and Variable Manager Auto-Expand
 *
 * Design Decisions: CANVAS-85 (console paused line), CANVAS-87 (Variable
 * Manager auto-expands on pause); the frontend WS subscription wires
 * status/log/panel transitions
 * REQ: REQ-3.2.2.5 (Real-time progress monitoring)
 *
 * Pass Criteria:
 * 1. On pause, the Console emits an amber `⏸ Paused at <Name> (<reason>)`
 *    line. The log row is rendered with the `log-variant-paused` class, the
 *    level is WARN, and the source is DEBUG.
 * 2. Variable Manager panel transitions to `data-state="expanded"` on pause.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../functional/debug-run/fixture-flat.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw)
  fixture.name = `V-CANVAS-17 - ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndPause(page: Page, nameSuffix: string): Promise<void> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: loadFixture(nameSuffix),
  })
  const body = await createResp.json().catch(() => null)
  expect(
    createResp.ok(),
    `POST /tests failed: ${createResp.status()} - ${JSON.stringify(body)}`,
  ).toBeTruthy()
  const testId = body.data?.id || body.id

  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)

  const node = page.locator('[data-testid="workflow-node-log-2"]')
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()

  await page.locator('[data-testid="environment-selector"]').click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(envPopover).not.toBeVisible()

  await page.locator('[data-testid="debug-button"]').click()

  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'paused',
    { timeout: 15_000 },
  )
}

async function stopAndSettle(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
  await expect(page.locator('[data-testid="workflow-status"]')).toHaveAttribute(
    'data-status',
    'stopped',
    { timeout: 10_000 },
  )
}

test.describe('V-CANVAS-17: Paused console and Variable Manager', () => {
  test('V-CANVAS-17-S1: paused console line rendered with amber styling and correct text', async ({
    page,
  }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    // Expand the console if the panel is collapsed.
    const console_ = page.locator('[data-testid="console-panel"]').first()
    const state = await console_.getAttribute('data-state')
    if (state === 'collapsed') {
      await page
        .locator('[data-testid="console-panel-header"] button[aria-label="Toggle console"]')
        .first()
        .click()
    }

    // The log-entry row for the paused line. The `log-variant-paused`
    // style class is applied per the unit-test contract.
    const pausedLog = page
      .locator('[data-testid^="log-entry-"]:has([data-testid="log-entry-message"])')
      .filter({ hasText: '⏸ Paused at Flat 2 (breakpoint)' })
      .first()
    await expect(pausedLog).toBeVisible()
    await expect(pausedLog).toHaveClass(/log-variant-paused/)

    // Source reads DEBUG, level reads WARN.
    const source = pausedLog.locator('[data-testid="log-entry-source"]')
    await expect(source).toHaveText(/DEBUG/)
    const level = pausedLog.locator('.level-badge')
    await expect(level).toHaveText(/WARN/)

    await stopAndSettle(page)
  })

  test('V-CANVAS-17-S2: Variable Manager auto-expands on pause', async ({ page }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    const varPanel = page.locator('[data-testid="variable-manager"]').first()
    // Panel must be rendered and expanded after pause.
    await expect(varPanel).toBeVisible({ timeout: 5_000 })
    await expect(varPanel).toHaveAttribute('data-state', 'expanded')

    await stopAndSettle(page)
  })
})
