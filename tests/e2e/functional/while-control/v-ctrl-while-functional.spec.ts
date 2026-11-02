/**
 * V-CTRL-WHILE-FUNCTIONAL: While Loop Control End-to-End Execution Test
 *
 * Single workflow chaining all While Loop permutations in one fixture:
 *   F1:  While-Do, counter<3, 3 iterations (literal condition)
 *   F6:  While-Do, condition false initially, 0 iterations (halt trap in body)
 *   F7:  Do-While, counter<3, 3 iterations
 *   F9:  Do-While, condition false initially, exactly 1 iteration
 *   F3:  While-Do, AND condition (c5<5 AND c5<3), 3 iterations
 *   F4:  While-Do, OR condition (c6<2 OR c6<4), 4 iterations
 *   F2:  While-Do, expression condition (c8<3), 3 iterations
 *   F17: Index available in body via output binding
 *   F18: Index available on then-path (final value = total iterations)
 *   F11: max_iterations=5 wrapped in try-catch (caught)
 *   F13: timeout=1s wrapped in try-catch (caught)
 *   F15/F16: Body error (halt) wrapped in try-catch (caught)
 *
 * Workflow status is "passed" because all failure scenarios are caught by try-catch.
 *
 * REQ: REQ-3.5.1.17
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

async function selectEnvironment(page: Page, envName: string) {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${envName}")`).first().click()
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

test.describe('While Loop Control E2E Execution', () => {

  test('All permutations: WD, DW, AND, OR, expr, index, maxiter, timeout, body-error', async ({ page }) => {
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
    // Timeout While loop takes ~1s before timing out, allow extra time
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })

    const statusVal = await status.getAttribute('data-status')
    const logs = await getLogTexts(page)
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')

    // Always dump diagnostics for debugging
    dumpDiagnostics(statusVal, await getNodeStatuses(page), logEntries)

    // Workflow passes because all failure scenarios are wrapped in try-catch
    expect(statusVal, `Expected 'passed' (try-catch handles errors), got '${statusVal}'`).toBe('passed')

    // --- F1: While-Do counter<3 - 3 iterations with w1=0,1,2 ---
    await test.step('F1: While-Do counter<3 - 3 iterations', () => {
      expect(logs.some((t) => t.includes('wd-count-0')), `Missing 'wd-count-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-count-1')), `Missing 'wd-count-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-count-2')), `Missing 'wd-count-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'wd-count-3'), 'wd-count-3 should NOT exist').toBeFalsy()
    })

    // --- F6: While-Do false initially - 0 iterations ---
    // The halt trap in body proves it never ran (workflow would fail otherwise)

    // --- F7: Do-While counter<3 - 3 iterations with w3=0,1,2 ---
    await test.step('F7: Do-While counter<3 - 3 iterations', () => {
      expect(logs.some((t) => t.includes('dw-count-0')), `Missing 'dw-count-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('dw-count-1')), `Missing 'dw-count-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('dw-count-2')), `Missing 'dw-count-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'dw-count-3'), 'dw-count-3 should NOT exist').toBeFalsy()
    })

    // --- F9: Do-While false initially - exactly 1 iteration ---
    await test.step('F9: Do-While false initially - exactly 1 iteration', () => {
      expect(logs.some((t) => t.includes('dw-once-0')), `Missing 'dw-once-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'dw-once-1'), 'dw-once-1 should NOT exist (only 1 iter)').toBeFalsy()
    })

    // --- F3: While-Do AND condition (c5<5 AND c5<3) - 3 iterations ---
    await test.step('F3: While-Do AND condition - 3 iterations', () => {
      expect(logs.some((t) => t.includes('wd-and-0')), `Missing 'wd-and-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-and-1')), `Missing 'wd-and-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-and-2')), `Missing 'wd-and-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'wd-and-3'), 'wd-and-3 should NOT exist (AND: c5<3 fails)').toBeFalsy()
    })

    // --- F4: While-Do OR condition (c6<2 OR c6<4) - 4 iterations ---
    await test.step('F4: While-Do OR condition - 4 iterations', () => {
      expect(logs.some((t) => t.includes('wd-or-0')), `Missing 'wd-or-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-or-1')), `Missing 'wd-or-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-or-2')), `Missing 'wd-or-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-or-3')), `Missing 'wd-or-3'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'wd-or-4'), 'wd-or-4 should NOT exist (OR: both fail)').toBeFalsy()
    })

    // --- F2: While-Do expression condition (c8<3) - 3 iterations ---
    await test.step('F2: While-Do expression condition - 3 iterations', () => {
      expect(logs.some((t) => t.includes('wd-expr-0')), `Missing 'wd-expr-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-expr-1')), `Missing 'wd-expr-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('wd-expr-2')), `Missing 'wd-expr-2'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'wd-expr-3'), 'wd-expr-3 should NOT exist').toBeFalsy()
    })

    // --- F17: Index available in body ---
    await test.step('F17: Index available in body', () => {
      expect(logs.some((t) => t.includes('idx-body-0')), `Missing 'idx-body-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('idx-body-1')), `Missing 'idx-body-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('idx-body-2')), `Missing 'idx-body-2'\n${all}`).toBeTruthy()
    })

    // --- F18: Index on then-path equals total iterations ---
    await test.step('F18: Index on then-path equals total iterations', () => {
      expect(logs.some((t) => t.includes('idx-then-3')), `Missing 'idx-then-3'\n${all}`).toBeTruthy()
    })

    // --- Then-path continuation ---
    await test.step('After all loops: then-path continuation', () => {
      expect(logs.some((t) => t.includes('after-all-loops')), `Missing 'after-all-loops'\n${all}`).toBeTruthy()
    })

    // --- F11: max_iterations=5 caught by try-catch ---
    await test.step('F11: max_iterations caught by try-catch', () => {
      expect(logs.some((t) => t.includes('mi-iter-0')), `Missing 'mi-iter-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('mi-iter-4')), `Missing 'mi-iter-4'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'mi-iter-5'), 'mi-iter-5 should NOT exist (max=5)').toBeFalsy()
      expect(logs.some((t) => t.includes('maxiter-caught')),
        `Missing 'maxiter-caught'\n${all}`).toBeTruthy()
    })

    // --- F13: timeout=1s caught by try-catch ---
    await test.step('F13: timeout caught by try-catch', () => {
      expect(logs.some((t) => t.includes('to-iter-0')), `Missing 'to-iter-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t === 'to-iter-10'), 'to-iter-10 should NOT exist').toBeFalsy()
      expect(logs.some((t) => t.includes('timeout-caught')),
        `Missing 'timeout-caught'\n${all}`).toBeTruthy()
    })

    // --- F15/F16: Body error caught by try-catch ---
    await test.step('F15/F16: body error caught by try-catch', () => {
      expect(logs.some((t) => t.includes('body-err-ran')),
        `Missing 'body-err-ran' - body did execute before halt\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('body-err-caught')),
        `Missing 'body-err-caught'\n${all}`).toBeTruthy()
    })
  })
})
