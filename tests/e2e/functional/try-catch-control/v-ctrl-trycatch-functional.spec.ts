/**
 * V-CTRL-TRYCATCH-FUNCTIONAL: Try/Catch Control End-to-End Execution Test
 *
 * Single workflow with eight chained Try/Catch blocks covering all 2x2x2
 * permutations: try OK/FAIL x catch on/off x finally on/off.
 * Imported once, run once, all log markers verified in one pass.
 *
 * Permutation matrix:
 *   F1: Try OK,   catch on,  finally off  -> try + then
 *   F2: Try OK,   catch off, finally off  -> try + then
 *   F3: Try OK,   catch on,  finally on   -> try + finally + then
 *   F4: Try OK,   catch off, finally on   -> try + finally + then
 *   F5: Try FAIL, catch on,  finally off  -> catch + then (error caught)
 *   F6: Try FAIL, catch off, finally off  -> then (error suppressed)
 *   F7: Try FAIL, catch on,  finally on   -> catch + finally + then
 *   F8: Try FAIL, catch off, finally on   -> finally + then (error suppressed)
 *
 * REQ: REQ-3.2.2.6, REQ-3.2.2.9, REQ-3.2.2.10-12
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
} from '../../helpers/fixture-import'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import {
  toggleBreakpoint,
  setDebugOption,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickStepOver,
} from '../debug-step/helpers'
import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(file = 'fixture.json'): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, file), 'utf-8'))
}

async function selectEnvironment(page: Page, E2E_ENV_NAME: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}



async function getNodeStatuses(page: Page) {
  return page.evaluate(() => {
    const nodes = document.querySelectorAll('[data-testid^="workflow-node-"]')
    return Array.from(nodes).map((n) => ({
      testId: n.getAttribute('data-testid'),
      status: n.getAttribute('data-execution-status'),
      name: n.textContent?.substring(0, 80) || null,
    }))
  })
}

function dumpDiagnostics(
  status: string | null,
  nodeStatuses: Array<{ testId: string | null; status: string | null; name: string | null }>,
  logEntries: string[]
) {
  test.info().annotations.push({ type: 'workflow-status', description: status ?? 'null' })
  test.info().annotations.push({ type: 'node-statuses', description: JSON.stringify(nodeStatuses) })
  test.info().annotations.push({
    type: 'error-logs',
    description: JSON.stringify(logEntries.filter((e) => e.startsWith('[ERROR]') || e.startsWith('[WARN]'))),
  })
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Try/Catch Control E2E Execution', () => {

  test('All try/catch/finally permutations (F1-F8)', async ({ page }) => {
    const fixture = loadFixture()

    // Ensure shared environment exists
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    // Navigate
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Run
    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })

    const statusVal = await status.getAttribute('data-status')
    if (statusVal !== 'passed') dumpDiagnostics(statusVal, await getNodeStatuses(page), await getLogLines(page))
    expect(statusVal).toBe('passed')

    // Collect logs once
    const logs = await getLogTexts(page)
    const all = logs.join('\n')
    const logEntries = await getLogLines(page)

    const assertPresent = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()
    const assertAbsent = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `"${marker}" should NOT be in logs`).toBeFalsy()

    // Bookends - proves full chain executed
    assertPresent('before-all')
    assertPresent('after-all')

    // F1: Try OK, catch=on, finally=off -> try executes, catch skipped
    await test.step('F1: try OK, catch=on, finally=off', () => {
      assertPresent('f1-try')
      assertAbsent('f1-catch')
    })

    // F2: Try OK, catch=off, finally=off -> try executes (minimal config)
    await test.step('F2: try OK, catch=off, finally=off', () => {
      assertPresent('f2-try')
    })

    // F3: Try OK, catch=on, finally=on -> try + finally, catch skipped
    await test.step('F3: try OK, catch=on, finally=on', () => {
      assertPresent('f3-try')
      assertPresent('f3-finally')
      assertAbsent('f3-catch')
    })

    // F4: Try OK, catch=off, finally=on -> try + finally
    await test.step('F4: try OK, catch=off, finally=on', () => {
      assertPresent('f4-try')
      assertPresent('f4-finally')
    })

    // F5: Try FAIL, catch=on, finally=off -> catch fires, engine logs warning
    await test.step('F5: try FAILS, catch=on, finally=off', () => {
      assertPresent('f5-catch')
      expect(
        logEntries.some((e) => e.includes('Try-path error caught')),
        'Engine should log that try-path error was caught'
      ).toBeTruthy()
    })

    // F6: Try FAIL, catch=off, finally=off -> error suppressed, chain continues
    // (no path markers - completion proved by F7/F8 markers and after-all bookend)
    await test.step('F6: try FAILS, catch=off, finally=off', () => {
      // Execution continued past F6 is proved by subsequent markers
    })

    // F7: Try FAIL, catch=on, finally=on -> catch + finally
    await test.step('F7: try FAILS, catch=on, finally=on', () => {
      assertPresent('f7-catch')
      assertPresent('f7-finally')
    })

    // F8: Try FAIL, catch=off, finally=on -> finally only, error suppressed
    await test.step('F8: try FAILS, catch=off, finally=on', () => {
      assertPresent('f8-finally')
    })
  })

  /**
   * The step-over completion hook lives in the walker that every scoped path
   * shares; this guards that a Step Over inside a try path always ends.
   */
  test('Step Over inside a try path re-pauses on that path next block', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-step-over.json'))

    await toggleBreakpoint(page, 'log-tso-try-1')
    // An armed pause-on-first would park on the block before the Try/Catch.
    await setDebugOption(page, 'first', false)
    await selectEnvironment(page, E2E_ENV_NAME)
    await startDebugRun(page)

    await expectPausedAt(page, 'log-tso-try-1', 30_000)

    await clickStepOver(page)
    await expectPausedAt(page, 'log-tso-try-2', 30_000)

    await test.step('The step ended ON the next try-path block, before it ran', async () => {
      const logs = await getLogTexts(page)
      expect(
        logs.some((t) => t.includes('tso-try-1')),
        `The stepped block must have run. Got: ${logs.join(' | ')}`,
      ).toBeTruthy()
      expect(
        logs.some((t) => t.includes('tso-try-2')),
        `The pause is BEFORE the next block. Got: ${logs.join(' | ')}`,
      ).toBeFalsy()
    })

    await test.step('Continuing finishes the try path and leaves through then', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed', 30_000)
      const logs = await getLogTexts(page)
      expect(logs.some((t) => t.includes('tso-try-2'))).toBeTruthy()
      expect(logs.some((t) => t.includes('tso-then'))).toBeTruthy()
      expect(
        logs.some((t) => t.includes('tso-catch')),
        `Nothing failed, so the catch path must stay unrun. Got: ${logs.join(' | ')}`,
      ).toBeFalsy()
    })
  })

  /**
   * KNOWN-FAILING - records an unfixed defect. Do not skip it and do not weaken
   * the assertion; it goes green when the engine is fixed.
   *
   * Asserts REQ-3.2.2.6:
   *   "The handler receives a structured error object containing type, message,
   *    origin location, and execution context, then executes within the same
   *    workflow with access to the current variable scope for inspection,
   *    recovery, logging, or propagation decisions."
   *   "Special variables containing the error object are accessible via
   *    standard variable references."
   *
   * The control binds its `error` and `caught` outputs only after the catch
   * chain has finished, so a catch block reads the pre-run values instead:
   * error is null and caught is false while the handler runs.
   */
  test('Catch path can read the error object and caught flag while it runs', async ({ page }) => {
    await importValidateAndNavigate(page, loadFixture('fixture-catch-sees-error.json'))

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 5_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 15_000 })

    const statusVal = await status.getAttribute('data-status')
    const logs = await getLogTexts(page)
    if (statusVal !== 'passed') dumpDiagnostics(statusVal, await getNodeStatuses(page), await getLogLines(page))
    expect(statusVal, `Run did not pass. Console: ${logs.join(' | ')}`).toBe('passed')

    const sessionId = await getActiveSessionId(page)
    const vars = await getSessionVariables(page, sessionId)

    await test.step('The try failed and the catch ran', () => {
      expect(
        logs.some((t) => t.includes('tce-catch')),
        `The catch path must have run. Console: ${logs.join(' | ')}`,
      ).toBeTruthy()
      expect(
        logs.some((t) => t.includes('tce-then')),
        `The construct must leave through then. Console: ${logs.join(' | ')}`,
      ).toBeTruthy()
    })

    await test.step('After the run the control has bound a populated error and caught=true', () => {
      expect(vars.tce_caught.value).toBe(true)
      expect(JSON.stringify(vars.tce_error.value)).toContain('ZeroDivisionError')
    })

    await test.step('The catch path saw the same values while it was running', () => {
      const seenError = vars.catch_saw_error.value as string
      const seenCaught = vars.catch_saw_caught.value
      expect(
        seenError,
        `Inside the catch, the error object must be populated. Saw: ${seenError}`,
      ).toContain('ZeroDivisionError')
      expect(
        seenCaught,
        `Inside the catch, caught must already be true. Saw: ${JSON.stringify(seenCaught)}`,
      ).toBe(true)
    })
  })
})
