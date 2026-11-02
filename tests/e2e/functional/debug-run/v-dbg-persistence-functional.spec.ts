/**
 * V-DBG-PERSISTENCE-FUNCTIONAL: Debug - Persistence Semantics
 *
 * Covers:
 *
 *   (m) Debug options persist per browser; breakpoints do NOT persist across
 *       reload. Tick "Pause on first block" -> reload -> popover still shows
 *       it ticked (localStorage key ``wave.workbench.debugOptions``). Set a
 *       breakpoint -> reload -> breakpoint is gone (breakpoints are
 *       in-memory only).
 *
 * REQ: REQ-3.2.1.2, REQ-3.2.2.1 (persistence contracts)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-flat.json'), 'utf-8')
  const fixture = JSON.parse(raw)
  fixture.name = 'Debug - persistence m'
  return fixture
}

async function importAndNavigate(page: Page, fixture: Record<string, unknown>): Promise<string> {
  await page.request
    .delete(`http://localhost:${BACKEND_PORT}/workbench/session/`)
    .catch(() => {})
  await ensureEnvironment(page.request)

  const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, {
    data: fixture,
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

async function openDebugOptionsPopover(page: Page) {
  await page.locator('[data-testid="debug-options-gear"]').click()
  const popover = page.locator('[data-testid="debug-options-popover"]')
  await expect(popover).toBeVisible()
  return popover
}

async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

test.describe('V-DBG-PERSISTENCE: Debug - Reload Semantics', () => {
  test('(m) debug options persist across reload; breakpoints do NOT', async ({ page }) => {
    const testId = await importAndNavigate(page, loadFixture())

    // Step 1: tick "Pause on first block".
    let popover = await openDebugOptionsPopover(page)
    const firstCheckbox = popover.locator('[data-testid="pause-on-first-checkbox"]')
    const initial = await firstCheckbox.getAttribute('data-state')
    if (initial !== 'checked') {
      await firstCheckbox.click()
    }
    await expect(firstCheckbox).toHaveAttribute('data-state', 'checked')
    await page.keyboard.press('Escape')
    await expect(popover).not.toBeVisible()

    // Step 2: set a breakpoint on log-2.
    await toggleBreakpoint(page, 'log-2')
    await expect(
      page.locator('[data-testid="workflow-node-log-2"] [data-testid="node-breakpoint-dot"]'),
    ).toBeVisible()

    // Step 3: reload the page. page.reload() mirrors the user-visible F5
    // behavior: same URL, fresh React mount, localStorage preserved, Zustand
    // state goes through its rehydration path. Using `page.goto` on the same
    // URL sometimes skips the full navigation and leaves the canvas overlay
    // stuck on the previous mount.
    await page.reload()
    await waitForCanvasLoad(page)
    // testId is only referenced for documentation; silence the unused linter
    // warning in Playwright's type checker.
    void testId

    // Debug options popover still shows "Pause on first block" ticked.
    popover = await openDebugOptionsPopover(page)
    await expect(popover.locator('[data-testid="pause-on-first-checkbox"]')).toHaveAttribute(
      'data-state',
      'checked',
    )
    await page.keyboard.press('Escape')
    await expect(popover).not.toBeVisible()

    // Breakpoint on log-2 is gone (breakpoints are in-memory only).
    await expect(
      page.locator('[data-testid="workflow-node-log-2"] [data-testid="node-breakpoint-dot"]'),
    ).toHaveCount(0)
  })
})
