/**
 * V-DBG-TRYCATCH-FUNCTIONAL: Debug - Nested Try/Catch
 *
 * Exercises the engine pauses on nodes nested inside a Try/Catch
 * body. Covers:
 *
 *   (c)/(h) pause_on_errors on a node INSIDE a Try/Catch body: engine pauses
 *           AT the failing nested node (reason="error"), try-catch handler
 *           runs only after Continue.
 *   (g)     Breakpoint on a node INSIDE a Try/Catch body pauses BEFORE that
 *           body node runs (reason="breakpoint"); catch path not entered.
 *
 * REQ: REQ-3.2.1.2, REQ-3.2.2.1, REQ-3.2.2.3, REQ-3.2.2.5
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(nameOverride?: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-trycatch.json'), 'utf-8')
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
  await page.keyboard.press('Escape')
  await expect(popover).not.toBeVisible()
}

async function startDebugRun(page: Page): Promise<void> {
  await page.locator('[data-testid="debug-button"]').click()
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-DBG-TRYCATCH: Debug - Nested Try/Catch Body', () => {
  // -------------------------------------------------------------------------
  // (c)/(h) pause_on_errors on a failing node inside a try path
  // -------------------------------------------------------------------------
  test('(c)(h) pause_on_errors pauses AT failing node inside try-path', async ({ page }) => {
    const fixture = loadFixture('Debug - nested c/h')
    await importAndNavigate(page, fixture)

    await setDebugOption(page, 'errors', true)
    await selectEnvironment(page)
    await startDebugRun(page)

    // log-fail raises ZeroDivisionError (message "1/0"). Engine must pause
    // AT log-fail BEFORE the try-catch handler runs.
    await expectPausedAt(page, 'log-fail')

    // The "In Catch" node MUST NOT have run yet - pause is before catch.
    const logsBeforeContinue = await getLogTexts(page)
    expect(
      logsBeforeContinue.some((t) => t.includes('tc-in-catch')),
      `"tc-in-catch" must not appear before Continue. Got logs: ${logsBeforeContinue.join(' | ')}`,
    ).toBeFalsy()

    await clickContinue(page)

    // After Continue, try-catch handles the exception, catch-path runs,
    // then log-after, and the session terminates as passed.
    await waitForStatus(page, 'passed')

    const logs = await getLogTexts(page)
    expect(logs.some((t) => t.includes('tc-before'))).toBeTruthy()
    expect(logs.some((t) => t.includes('tc-in-try'))).toBeTruthy()
    expect(logs.some((t) => t.includes('tc-in-catch'))).toBeTruthy()
    expect(logs.some((t) => t.includes('tc-after'))).toBeTruthy()

    // Paused-on-error console line format:
    //   "⏸ Paused on error at Fail: <ExceptionClass>: <message>"
    // The engine wraps raw Python errors inside ``InvalidExpressionError`` when
    // they originate from expression evaluation (e.g. "1/0"). Accept either
    // the wrapping class or the underlying Python exception name.
    const lines = await getLogLines(page)
    const errorLine = lines.find((l) => l.includes('⏸ Paused on error at Fail'))
    expect(errorLine, `Expected "⏸ Paused on error at Fail: ..." in logs. Got: ${lines.join(' | ')}`).toBeTruthy()
    expect(errorLine).toMatch(/InvalidExpressionError|ZeroDivisionError/)
  })

  // -------------------------------------------------------------------------
  // (g) Breakpoint on a node inside a try-body pauses BEFORE that node runs.
  //     Use the normal (non-failing) log-in-try. No pause_on_errors. After
  //     Continue, the try-body continues and log-fail raises -> catch runs.
  // -------------------------------------------------------------------------
  test('(g) breakpoint on nested try-body node pauses before node runs', async ({ page }) => {
    const fixture = loadFixture('Debug - nested g')
    await importAndNavigate(page, fixture)

    await toggleBreakpoint(page, 'log-in-try')
    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-in-try')

    // log-in-try hasn't run yet (pause is BEFORE node execution).
    const logsBeforeContinue = await getLogTexts(page)
    expect(
      logsBeforeContinue.some((t) => t.includes('tc-in-try')),
      `"tc-in-try" must not appear before Continue. Got: ${logsBeforeContinue.join(' | ')}`,
    ).toBeFalsy()

    await clickContinue(page)
    await waitForStatus(page, 'passed')

    const logs = await getLogTexts(page)
    expect(logs.some((t) => t.includes('tc-in-try'))).toBeTruthy()
    expect(logs.some((t) => t.includes('tc-in-catch'))).toBeTruthy()
    expect(logs.some((t) => t.includes('tc-after'))).toBeTruthy()

    // Paused console line uses reason="breakpoint" for a breakpoint pause.
    const lines = await getLogLines(page)
    expect(
      lines.some((l) => l.includes('⏸') && l.includes('In Try') && l.includes('(breakpoint)')),
      `Expected "⏸ Paused at In Try (breakpoint)". Got: ${lines.join(' | ')}`,
    ).toBeTruthy()
  })
})
