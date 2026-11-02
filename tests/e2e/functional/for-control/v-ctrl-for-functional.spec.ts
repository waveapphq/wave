/**
 * V-CTRL-FOR-FUNCTIONAL: For Loop Control End-to-End Execution Test
 *
 * Single workflow chaining six For Loops to cover all permutations:
 *   1. For(count=3): body executes 3 times with i=0,1,2
 *   2. For(count=0): body skipped entirely (empty loop)
 *   3. For(range 0..10 step=2): body executes 5 times with k=0,2,4,6,8
 *   4. For(count via expression): count resolved from variable loop_count=4, body executes 4 times with m=0,1,2,3
 *   5. For(range via expression): start/end/step resolved from variables (10..15 step=1), body executes 5 times with n=10,11,12,13,14
 *   6. For(count=100, timeout=1s): partial execution with 200ms delay body,
 *      wrapped in try-catch so the timeout error is caught and the workflow passes
 * The first five feed into a final "Log After", then the try-catch-wrapped
 * timeout For runs last. Workflow status is "passed" because the catch handles
 * the timeout error.
 *
 * REQ: REQ-3.5.1.15
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
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

test.describe('For Loop Control E2E Execution', () => {

  test('Six chained For Loops: count=3, count=0, range, expr-count, expr-range, timeout', async ({ page }) => {
    const fixture = loadFixture()

    // Import
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await ensureEnvironment(page.request)

    const createResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests`, { data: fixture })
    const createBody = await createResp.json().catch(() => null)
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()} - ${JSON.stringify(createBody)}`).toBeTruthy()
    const testId = createBody.data?.id || createBody.id

    // Validate
    const valResp = await page.request.post(`http://localhost:${BACKEND_PORT}/tests/${testId}/validate`)
    const valBody = await valResp.json()
    expect(valResp.ok(), `Validation failed: ${JSON.stringify(valBody)}`).toBeTruthy()

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
    // Timeout For loop takes ~1s before timing out, allow extra time for full workflow
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    // The workflow engine flips `session.status` to passed the moment
    // the main loop exits, but the final batch of log WebSocket events
    // still takes a tick or two to land in the console's log-store.
    // Poll for the last-emitted log so iteration-count assertions
    // further down can't race the broadcast tail. The fixture's
    // post-loop node (`Log After`) emits `after-all-loops`.
    await expect
      .poll(async () => (await getLogTexts(page)).some((t) => t.includes('after-all-loops')), {
        timeout: 10_000,
        message: 'Post-loop log should land in the console before assertions',
      })
      .toBe(true)

    const statusVal = await status.getAttribute('data-status')
    const logs = await getLogTexts(page)
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')

    // Always dump diagnostics for debugging
    dumpDiagnostics(statusVal, await getNodeStatuses(page), logEntries)

    // Workflow ends as "passed" because the timeout For loop is wrapped in try-catch,
    // which catches the timeout error and allows the workflow to complete successfully.
    expect(statusVal, `Expected 'passed' (try-catch handles timeout), got '${statusVal}'`).toBe('passed')

    // --- For(count=3): 3 iterations with i=0,1,2 ---
    await test.step('For count=3: 3 iterations', () => {
      expect(logs.some((t) => t.includes('before-loop')), `Missing 'before-loop'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('count-iter-0')), `Missing 'count-iter-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('count-iter-1')), `Missing 'count-iter-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('count-iter-2')), `Missing 'count-iter-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'count-iter-3'), 'count-iter-3 should NOT exist').toBeFalsy()
    })

    // --- For(count=0): no body iterations at all ---
    // (no specific log marker - absence of any "count0-iter" proves it was skipped)

    // --- For(range 0..10 step=2): 5 iterations with k=0,2,4,6,8 ---
    await test.step('For range 0..10 step=2: 5 iterations', () => {
      expect(logs.some((t) => t.includes('range-iter-0')), `Missing 'range-iter-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('range-iter-2')), `Missing 'range-iter-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('range-iter-4')), `Missing 'range-iter-4'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('range-iter-6')), `Missing 'range-iter-6'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('range-iter-8')), `Missing 'range-iter-8'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'range-iter-1'), 'range-iter-1 should NOT exist').toBeFalsy()
      expect(logs.some((t) => t === 'range-iter-10'), 'range-iter-10 should NOT exist').toBeFalsy()
    })

    // --- For(count via expression): 4 iterations with m=0,1,2,3 from variable loop_count=4 ---
    await test.step('For count via expression: 4 iterations from variable', () => {
      expect(logs.some((t) => t.includes('expr-count-iter-0')), `Missing 'expr-count-iter-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-count-iter-1')), `Missing 'expr-count-iter-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-count-iter-2')), `Missing 'expr-count-iter-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-count-iter-3')), `Missing 'expr-count-iter-3'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'expr-count-iter-4'), 'expr-count-iter-4 should NOT exist').toBeFalsy()
    })

    // --- For(range via expression): 5 iterations with n=10,11,12,13,14 from variables ---
    await test.step('For range via expression: 5 iterations 10..14', () => {
      expect(logs.some((t) => t.includes('expr-range-iter-10')), `Missing 'expr-range-iter-10'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-range-iter-11')), `Missing 'expr-range-iter-11'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-range-iter-12')), `Missing 'expr-range-iter-12'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-range-iter-13')), `Missing 'expr-range-iter-13'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('expr-range-iter-14')), `Missing 'expr-range-iter-14'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'expr-range-iter-9'), 'expr-range-iter-9 should NOT exist').toBeFalsy()
      expect(logs.some((t) => t === 'expr-range-iter-15'), 'expr-range-iter-15 should NOT exist').toBeFalsy()
    })

    // --- Then-path: all non-timeout loops completed, final log reached ---
    await test.step('Log After: then-path continuation works', () => {
      expect(logs.some((t) => t.includes('after-all-loops')), `Missing 'after-all-loops'\n${all}`).toBeTruthy()
    })

    // --- For(count=100, timeout=1s) wrapped in try-catch: partial execution, catch handles timeout ---
    await test.step('For timeout: partial iterations and catch handles timeout', () => {
      // With 200ms delay per iteration and 1s timeout:
      // - Several iterations complete (~4-5 depending on overhead)
      // - Then timeout interrupts, try-catch catches the error
      expect(logs.some((t) => t.includes('timeout-iter-0')), `Missing 'timeout-iter-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('timeout-iter-1')), `Missing 'timeout-iter-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('timeout-iter-2')), `Missing 'timeout-iter-2'\n${all}`).toBeTruthy()

      // Items 10+ definitely should NOT have executed (would need 2s+)
      expect(logs.some((t) => t === 'timeout-iter-10'), 'timeout-iter-10 should NOT exist').toBeFalsy()
      expect(logs.some((t) => t === 'timeout-iter-99'), 'timeout-iter-99 should NOT exist').toBeFalsy()

      // Catch path executed - the timeout was caught by try-catch
      expect(logs.some((t) => t.includes('timeout-caught')),
        `Missing 'timeout-caught' - catch path did not execute\n${all}`).toBeTruthy()
    })
  })
})
