/**
 * V-CANVAS-05: Running Toolbar - Pause Button Hidden
 *
 * Design Decisions: CANVAS-74..78 (running visuals). There is no manual Pause
 * while Running: a debug run pauses at a breakpoint or a debug option (first
 * block, errors), so the Pause button is hidden and Stop + Focus Current are
 * the only Running controls.
 * REQ: REQ-3.2.2.3 (Pause/resume execution - pause comes from breakpoints and
 * debug options, resume from Continue)
 *
 * Pass Criteria:
 * 1. While status=running, the Running toolbar renders Stop (split) and
 *    Focus Current buttons (CANVAS-74..78 minus the Pause button).
 * 2. While status=running, no Pause button is rendered anywhere in the DOM.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(nameSuffix: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, '../../functional/debug-run/fixture-delay.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw)
  // Backend rejects duplicate test names with a 500. Each test creates a
  // unique fixture so parallel / sequential runs in the same DB do not
  // collide.
  fixture.name = `V-CANVAS-05 - ${nameSuffix} ${Date.now()}`
  return fixture
}

async function importAndNavigate(page: Page, nameSuffix: string): Promise<string> {
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
  return testId
}

async function confirmStop(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
}

async function startAndWaitForRunning(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const envPopover = page.locator('[data-testid="environment-popover"]')
  await expect(envPopover).toBeVisible()
  await envPopover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(envPopover).not.toBeVisible()

  await page.locator('[data-testid="run-button"]').click()

  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', 'running', { timeout: 10_000 })
}

async function waitTerminal(page: Page): Promise<void> {
  const status = page.locator('[data-testid="workflow-status"]')
  // Delay fixture completes with passed; Stop would yield stopped. Either is fine.
  await expect
    .poll(async () => {
      const s = await status.getAttribute('data-status')
      return ['passed', 'failed', 'stopped', 'skipped'].includes(s || '')
    }, { timeout: 10_000 })
    .toBe(true)
}

test.describe('V-CANVAS-05: Running toolbar hides Pause', () => {
  test('V-CANVAS-05-S1: Running toolbar renders Stop and Focus Current', async ({ page }) => {
    await importAndNavigate(page, 'S1')
    await startAndWaitForRunning(page)

    await expect(page.locator('[data-testid="action-stop-button"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-focus-current-button"]')).toBeVisible()

    // Stop to end the run so fixture doesn't leak into the next test.
    await confirmStop(page)
    await waitTerminal(page)
  })

  test('V-CANVAS-05-S2: No Pause button rendered in Running state', async ({ page }) => {
    await importAndNavigate(page, 'S2')
    await startAndWaitForRunning(page)

    // No manual Pause: the button is hidden entirely. Neither the testid nor a
    // role=button with accessible name "Pause" should be found.
    await expect(page.locator('[data-testid="action-pause-button"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Pause', exact: true })).toHaveCount(0)

    await confirmStop(page)
    await waitTerminal(page)
  })

  test('V-CANVAS-05-S3: Idle controls (Run / Debug / gear) hidden while Running', async ({
    page,
  }) => {
    await importAndNavigate(page, 'S3')
    await startAndWaitForRunning(page)

    await expect(page.locator('[data-testid="run-button"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="debug-button"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="debug-options-gear"]')).toHaveCount(0)

    await confirmStop(page)
    await waitTerminal(page)
  })
})
