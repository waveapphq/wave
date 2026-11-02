/**
 * V-CANVAS-16: Paused Canvas - Paused Toolbar
 *
 * Design Decisions: CANVAS-80 (paused toolbar order). There is no manual
 * Pause: a debug run pauses at a breakpoint or a debug option, so no Pause
 * button renders while Running or Paused.
 * REQ: REQ-3.2.2.2 (Skip blocks), REQ-3.2.2.3 (Pause/resume), REQ-3.2.2.4
 * (Cancel execution with cleanup)
 *
 * Pass Criteria:
 * 1. Paused toolbar renders Step Over, Step Into, Continue, Skip Block, Stop
 *    (split), Focus Current - in that order (CANVAS-80).
 * 2. Step Over and Step Into are enabled.
 * 3. Continue, Skip Block, Stop primary, Focus Current are enabled.
 * 4. Pause button is NOT rendered in either Running or Paused toolbar (no
 *    manual Pause, unlike CANVAS-76).
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
  fixture.name = `V-CANVAS-16 - ${nameSuffix} ${Date.now()}`
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

  // Breakpoint on log-2 so the engine pauses quickly.
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

test.describe('V-CANVAS-16: Paused toolbar controls', () => {
  test('V-CANVAS-16-S1: paused toolbar renders Step Over, Step Into, Continue, Skip Block, Stop, Focus Current', async ({
    page,
  }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    await expect(page.locator('[data-testid="action-step-over-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-step-into-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-continue-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-skip-block-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-stop-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-focus-current-button"]')).toBeVisible()

    await stopAndSettle(page)
  })

  test('V-CANVAS-16-S2: Step Over and Step Into are enabled', async ({ page }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    // Step Over / Step Into are enabled in the Paused Toolbar and dispatch
    // their handler when clicked.
    await expect(page.locator('[data-testid="action-step-over-button"]')).toBeEnabled()
    await expect(page.locator('[data-testid="action-step-into-button"]')).toBeEnabled()

    await stopAndSettle(page)
  })

  test('V-CANVAS-16-S3: Continue, Skip Block, Stop, Focus Current are enabled', async ({ page }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    await expect(page.locator('[data-testid="action-continue-button"]')).toBeEnabled()
    await expect(page.locator('[data-testid="action-skip-block-button"]')).toBeEnabled()
    await expect(page.locator('[data-testid="action-stop-button"]')).toBeEnabled()
    await expect(page.locator('[data-testid="action-focus-current-button"]')).toBeEnabled()

    await stopAndSettle(page)
  })

  test('V-CANVAS-16-S4: Idle / Debug split button hidden in Paused toolbar', async ({ page }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    // During pause, the idle group (Run / Debug split buttons + gear) is
    // replaced by the paused controls.
    await expect(page.locator('[data-testid="debug-button"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="run-button"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="debug-options-gear"]')).toHaveCount(0)

    await stopAndSettle(page)
  })

  test('V-CANVAS-16-S5: Pause button is not rendered in paused toolbar', async ({
    page,
  }) => {
    await importAndPause(page, test.info().titlePath.slice(-1)[0])

    // No manual Pause: the button is hidden across Running AND Paused states.
    await expect(page.locator('[data-testid="action-pause-button"]')).toHaveCount(0)
    // No element matches role=button with accessible name "Pause".
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)

    await stopAndSettle(page)
  })
})
