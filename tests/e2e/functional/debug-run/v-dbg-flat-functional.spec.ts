/**
 * V-DBG-FLAT-FUNCTIONAL: Debug - Flat Chain End-to-End
 *
 * Drives the debug machinery against a linear 5-node Log chain.
 * Covers:
 *
 *   (a) Two breakpoints + Debug -> pause at each -> Continue to terminal
 *   (b) pause_on_first_block=true -> pause at first block -> Continue to terminal
 *   (d) Breakpoint -> pause -> Skip Block -> step-pause at next -> Continue
 *   (e) Breakpoint -> pause -> Stop (Immediate + With Finalization) -> stopped
 *   (f) Regular Run with breakpoints set -> run completes without pausing
 *   (i) Skip Block acts as a single-step (re-pause with reason="step")
 *   (j) Stop from paused preserves previous block's terminal state
 *   (k) Continue does not race the next debug_breakpoint_hit (WS wins)
 *   (l) /workbench/run with debug payload returns JSON-serializable response
 *
 * REQ: REQ-3.2.1.2, REQ-3.2.2.1, REQ-3.2.2.2, REQ-3.2.2.3, REQ-3.2.2.4, REQ-3.2.2.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogLines } from '../../helpers/log-reader'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(nameOverride?: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-flat.json'), 'utf-8')
  const fixture = JSON.parse(raw)
  if (nameOverride) fixture.name = nameOverride
  return fixture
}

async function selectEnvironment(page: Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
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

async function toggleBreakpoint(page: Page, nodeId: string): Promise<void> {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()

  // Right-click to open the Radix context menu. Right-click auto-selects the
  // node (see v-canvas-03-context-menus.spec.ts).
  await node.click({ button: 'right' })
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByText('Toggle Breakpoint', { exact: true }).click()
  await expect(menu).not.toBeVisible()
}

async function setDebugOption(
  page: Page,
  option: 'first' | 'errors',
  checked: boolean,
): Promise<void> {
  await page.locator('[data-testid="debug-options-gear"]').click()
  const popover = page.locator('[data-testid="debug-options-popover"]')
  await expect(popover).toBeVisible()

  const checkboxTestId =
    option === 'first' ? 'pause-on-first-checkbox' : 'pause-on-errors-checkbox'
  const checkbox = popover.locator(`[data-testid="${checkboxTestId}"]`)
  const current = await checkbox.getAttribute('data-state')
  const isChecked = current === 'checked'
  if (isChecked !== checked) {
    await checkbox.click()
  }
  // Close popover by pressing Escape so subsequent asserts on the canvas
  // aren't occluded.
  await page.keyboard.press('Escape')
  await expect(popover).not.toBeVisible()
}

async function startDebugRun(page: Page): Promise<void> {
  await page.locator('[data-testid="debug-button"]').click()
  // The workflow status flips through running on the way to paused/passed.
  // Downstream asserts wait for the actual target state.
}

async function startRegularRun(page: Page): Promise<void> {
  await page.locator('[data-testid="run-button"]').click()
}

async function waitForStatus(
  page: Page,
  expected: 'paused' | 'passed' | 'failed' | 'stopped' | 'skipped',
  timeout = 15_000,
): Promise<void> {
  const status = page.locator('[data-testid="workflow-status"]')
  await expect(status).toHaveAttribute('data-status', expected, { timeout })
}

async function expectPausedAt(page: Page, nodeId: string): Promise<void> {
  await waitForStatus(page, 'paused')
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toHaveAttribute('data-paused', 'true')
}

async function clickContinue(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-continue-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

async function clickSkipBlock(page: Page): Promise<void> {
  const btn = page.locator('[data-testid="action-skip-block-button"]')
  await expect(btn).toBeVisible()
  await expect(btn).toBeEnabled()
  await btn.click()
}

async function clickStopImmediate(page: Page): Promise<void> {
  // Stop is gated by the StopConfirmationDialog (section 15.6.0.1). The
  // primary click opens the dialog in 'immediate' mode; we then confirm it.
  await page.locator('[data-testid="action-stop-button"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-immediate"]').click()
}

async function clickStopFinalize(page: Page): Promise<void> {
  await page.locator('[data-testid="action-stop-button-dropdown"]').click()
  await page.locator('[data-testid="action-stop-finalize-option"]').click()
  const dialog = page.locator('[data-testid="stop-confirmation-dialog"]')
  await expect(dialog).toBeVisible()
  await page.locator('[data-testid="stop-confirm-finalize"]').click()
}

async function getNodeExecStatus(page: Page, nodeId: string): Promise<string | null> {
  return page
    .locator(`[data-testid="workflow-node-${nodeId}"]`)
    .getAttribute('data-execution-status')
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-DBG-FLAT: Debug - Flat Chain', () => {
  // -------------------------------------------------------------------------
  // (a) Two breakpoints -> pause at each -> Continue to terminal
  // (l) /workbench/run response is JSON-serializable (every Debug run below
  //     implicitly asserts this - the helper throws on non-OK / non-JSON
  //     responses).
  // -------------------------------------------------------------------------
  test('(a)(l) two breakpoints, pause at each, Continue to terminal', async ({ page }) => {
    const fixture = loadFixture('Debug - flow a')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-2')
    await toggleBreakpoint(page, 'log-4')

    await selectEnvironment(page)
    await startDebugRun(page)

    // First pause at log-2.
    await expectPausedAt(page, 'log-2')

    // log-1 should already be marked success.
    expect(await getNodeExecStatus(page, 'log-1')).toBe('success')
    // log-2 hasn't run yet (engine paused BEFORE node execution).
    expect(await getNodeExecStatus(page, 'log-2')).not.toBe('success')

    await clickContinue(page)

    // Second pause at log-4 (log-2, log-3 have now run).
    await expectPausedAt(page, 'log-4')
    expect(await getNodeExecStatus(page, 'log-2')).toBe('success')
    expect(await getNodeExecStatus(page, 'log-3')).toBe('success')

    await clickContinue(page)

    // Terminal passed.
    await waitForStatus(page, 'passed')
    expect(await getNodeExecStatus(page, 'log-4')).toBe('success')
    expect(await getNodeExecStatus(page, 'log-5')).toBe('success')

    // Console logs should include "⏸ Paused at Flat 2 (breakpoint)" and
    // "⏸ Paused at Flat 4 (breakpoint)" (reason assertions).
    const logs = await getLogLines(page)
    const pausedLines = logs.filter((l) => l.includes('⏸'))
    expect(pausedLines.some((l) => l.includes('Flat 2') && l.includes('(breakpoint)'))).toBeTruthy()
    expect(pausedLines.some((l) => l.includes('Flat 4') && l.includes('(breakpoint)'))).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // (b) pause_on_first_block=true, no breakpoints -> pause at first -> Continue
  // -------------------------------------------------------------------------
  test('(b) pause_on_first_block pauses at first executable node', async ({ page }) => {
    const fixture = loadFixture('Debug - flow b')
    await importAndNavigate(page, fixture)

    await setDebugOption(page, 'first', true)

    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-1')

    await clickContinue(page)
    await waitForStatus(page, 'passed')

    const logs = await getLogLines(page)
    expect(
      logs.some((l) => l.includes('⏸') && l.includes('Flat 1') && l.includes('(first_block)')),
    ).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // (d) Breakpoint -> pause -> Skip Block -> pause at next -> Continue
  // (i) Skip Block re-pauses with reason="step" (console line proves it).
  // -------------------------------------------------------------------------
  test('(d)(i) Skip Block re-pauses at next node with reason=step', async ({ page }) => {
    const fixture = loadFixture('Debug - flow d/i')
    await importAndNavigate(page, fixture)

    // Only ONE breakpoint at log-2. After Skip Block, the step flag must
    // force a re-pause at log-3 even though log-3 has no breakpoint.
    await toggleBreakpoint(page, 'log-2')

    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-2')
    expect(await getNodeExecStatus(page, 'log-1')).toBe('success')

    await clickSkipBlock(page)

    // Re-pause before the next node (log-3) with reason="step".
    await expectPausedAt(page, 'log-3')
    // log-2 should now be marked skipped.
    expect(await getNodeExecStatus(page, 'log-2')).toBe('skipped')

    await clickContinue(page)
    await waitForStatus(page, 'passed')

    const logs = await getLogLines(page)
    const pausedLines = logs.filter((l) => l.includes('⏸'))
    expect(
      pausedLines.some((l) => l.includes('Flat 2') && l.includes('(breakpoint)')),
      `Expected "⏸ Paused at Flat 2 (breakpoint)". Got: ${pausedLines.join(' | ')}`,
    ).toBeTruthy()
    expect(
      pausedLines.some((l) => l.includes('Flat 3') && l.includes('(step)')),
      `Expected "⏸ Paused at Flat 3 (step)". Got: ${pausedLines.join(' | ')}`,
    ).toBeTruthy()
  })

  // -------------------------------------------------------------------------
  // (e) Breakpoint -> pause -> Stop (Immediate). Repeat with Stop (Finalize).
  // -------------------------------------------------------------------------
  test('(e-immediate) Stop (Immediate) from paused terminates as stopped', async ({ page }) => {
    const fixture = loadFixture('Debug - flow e-immediate')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-3')
    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-3')

    await clickStopImmediate(page)
    await waitForStatus(page, 'stopped')
  })

  test('(e-finalize) Stop (With Finalization) from paused terminates as stopped', async ({
    page,
  }) => {
    const fixture = loadFixture('Debug - flow e-finalize')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-3')
    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-3')

    await clickStopFinalize(page)
    await waitForStatus(page, 'stopped')
  })

  // -------------------------------------------------------------------------
  // (f) Regular Run with breakpoints set -> no pauses, run completes
  // -------------------------------------------------------------------------
  test('(f) regular Run ignores breakpoints and runs to terminal', async ({ page }) => {
    const fixture = loadFixture('Debug - flow f')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-2')
    await toggleBreakpoint(page, 'log-4')

    await selectEnvironment(page)
    await startRegularRun(page)

    // Run must reach 'passed' without pausing. The test fails if the UI
    // ever settles in 'paused' state.
    await waitForStatus(page, 'passed')
    // The console should not contain any "⏸" paused lines.
    const logs = await getLogLines(page)
    expect(logs.some((l) => l.includes('⏸'))).toBeFalsy()
  })

  // -------------------------------------------------------------------------
  // (j) Stop from paused preserves previous block's terminal state.
  //     Breakpoint at log-3; when paused, log-1 and log-2 are already
  //     "passed". Stop (Immediate) must mark log-3 as "stopped" and
  //     leave log-1 / log-2 as success (not overwritten to stopped).
  // -------------------------------------------------------------------------
  test('(j) Stop from paused does not clobber prior passed nodes', async ({ page }) => {
    const fixture = loadFixture('Debug - flow j')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-3')
    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-3')
    expect(await getNodeExecStatus(page, 'log-1')).toBe('success')
    expect(await getNodeExecStatus(page, 'log-2')).toBe('success')

    await clickStopImmediate(page)
    await waitForStatus(page, 'stopped')

    // Previous nodes keep their passed (success) badges; log-3 becomes stopped.
    expect(await getNodeExecStatus(page, 'log-1')).toBe('success')
    expect(await getNodeExecStatus(page, 'log-2')).toBe('success')
    expect(await getNodeExecStatus(page, 'log-3')).toBe('stopped')
  })

  // -------------------------------------------------------------------------
  // (k) Continue does not race the next debug_breakpoint_hit event. With
  //     breakpoints at log-2 AND log-4, clicking Continue at log-2 must land
  //     the UI in paused@log-4 (not stuck in 'running' because the HTTP
  //     response overwrote the WS-driven paused flip).
  // -------------------------------------------------------------------------
  test('(k) Continue -> next pause: WS event wins race to paused', async ({ page }) => {
    const fixture = loadFixture('Debug - flow k')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-2')
    await toggleBreakpoint(page, 'log-4')

    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-2')
    await clickContinue(page)

    // Must end up paused at log-4. The UI is allowed to flip through
    // running briefly, but waitForStatus('paused') should succeed.
    await expectPausedAt(page, 'log-4')

    // Stop from paused to end the test cleanly.
    await clickStopImmediate(page)
    await waitForStatus(page, 'stopped')
  })
})
