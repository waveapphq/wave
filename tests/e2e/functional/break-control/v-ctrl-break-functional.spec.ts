/**
 * V-CTRL-BREAK-FUNCTIONAL: Break Control End-to-End Execution Test
 *
 * Thirteen break scenarios in a single workflow:
 *   S1: For(count=3) + break with log before/after (tests 1,5,6)
 *   S2: ForEach(3 items) + break (test 2)
 *   S3: While(True) + break (test 3)
 *   S4: For(count=3) + break as first node (test 4)
 *   S5: Nested For>ForEach, break targets inner (test 7)
 *   S6: Nested For>ForEach, break targets outer (test 8)
 *   S7: 3-level For>ForEach>While, break targets middle (test 9)
 *   S8: 3-level For>ForEach>While, break targets outermost (test 10)
 *   S9: Break inside try-catch in loop (test 11)
 *   S10: Break inside if-else true branch in loop (test 12)
 *   S11: Break inside if-else else branch in loop (test 13)
 *   S12: Combined: Continue then Break in same chain (test 28)
 *   S13: Combined: Break then Continue in same chain (test 29)
 *
 * REQ: REQ-3.5.1.2
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

test.describe('Break Control E2E Execution', () => {

  test('Thirteen break scenarios covering single-loop, nested, controls, and combined', async ({ page }) => {
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
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    const statusVal = await status.getAttribute('data-status')
    const logs = await getLogTexts(page)
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')

    // Always dump diagnostics for debugging
    dumpDiagnostics(statusVal, await getNodeStatuses(page), logEntries)

    expect(statusVal, `Expected 'passed', got '${statusVal}'`).toBe('passed')

    // Assertion helpers
    const assertPresent = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `Expected "${marker}" in logs.\n${all}`).toBeTruthy()

    const assertAbsent = (marker: string) =>
      expect(logs.some((t) => t.includes(marker)), `"${marker}" should NOT be in logs.\n${all}`).toBeFalsy()

    // --- S1: For(count=3), break fires on first iteration ---
    await test.step('S1: For(count=3) + break on first iteration', () => {
      assertPresent('before-break-tests')
      assertPresent('brk-s1-0')
      assertAbsent('brk-s1-1')
      assertAbsent('brk-s1-after-never')
      assertPresent('brk-s1-then-0')
    })

    // --- S2: ForEach(["a","b","c"]), break after first item ---
    await test.step('S2: ForEach(3 items) + break after first item', () => {
      assertPresent('brk-s2-0')
      assertAbsent('brk-s2-1')
      assertPresent('brk-s2-then')
    })

    // --- S3: While(True) + break exits immediately ---
    await test.step('S3: While(True) + break exits immediately', () => {
      assertPresent('brk-s3-body')
      assertPresent('brk-s3-then')
    })

    // --- S4: Break as first body node - zero work ---
    await test.step('S4: Break as first body node - zero work', () => {
      assertAbsent('brk-s4-never')
      assertPresent('brk-s4-then')
    })

    // --- S5: Nested For>ForEach, break targets INNER ---
    await test.step('S5: Nested For>ForEach, break targets inner', () => {
      assertPresent('brk-s5-inner-0')
      assertAbsent('brk-s5-inner-1')
      assertPresent('brk-s5-inner-then')
      assertPresent('brk-s5-outer-done')
    })

    // --- S6: Nested For>ForEach, break targets OUTER ---
    await test.step('S6: Nested For>ForEach, break targets outer', () => {
      assertPresent('brk-s6-inner-0')
      assertAbsent('brk-s6-inner-then-never')
      assertPresent('brk-s6-outer-done')
    })

    // --- S7: 3-level For>ForEach>While, break targets MIDDLE ---
    await test.step('S7: 3-level, break targets middle (fe-s7)', () => {
      assertPresent('brk-s7-deep')
      assertAbsent('brk-s7-while-never')
      assertPresent('brk-s7-fe-then')
      assertPresent('brk-s7-outer-done')
    })

    // --- S8: 3-level, break targets OUTERMOST ---
    await test.step('S8: 3-level, break targets outermost (for-s8)', () => {
      assertPresent('brk-s8-deep')
      assertAbsent('brk-s8-while-never')
      assertAbsent('brk-s8-fe-never')
      assertPresent('brk-s8-outer-done')
    })

    // --- S9: Break inside try-catch ---
    await test.step('S9: Break inside try-catch in loop', () => {
      assertPresent('brk-s9-try')
      assertAbsent('brk-s9-catch-never')
      assertPresent('brk-s9-for-then')
    })

    // --- S10: Break inside if-else TRUE branch ---
    await test.step('S10: Break inside if-else true branch', () => {
      assertPresent('brk-s10-true')
      assertAbsent('brk-s10-else-never')
      assertPresent('brk-s10-for-then')
    })

    // --- S11: Break inside if-else ELSE branch ---
    await test.step('S11: Break inside if-else else branch', () => {
      assertAbsent('brk-s11-if-never')
      assertPresent('brk-s11-else')
      assertPresent('brk-s11-for-then')
    })

    // --- S12: Combined: Continue first, then Break ---
    await test.step('S12: Combined - Continue then Break in same chain', () => {
      assertPresent('comb-s12-0')
      assertPresent('comb-s12-1')
      assertPresent('comb-s12-2')
      assertAbsent('comb-s12-never')
      assertPresent('comb-s12-then')
    })

    // --- S13: Combined: Break first, then Continue ---
    await test.step('S13: Combined - Break then Continue in same chain', () => {
      assertPresent('comb-s13-0')
      assertAbsent('comb-s13-1')
      assertAbsent('comb-s13-never')
      assertPresent('comb-s13-then')
    })

    // --- Final: after all break tests ---
    await test.step('Final: after-all-break-tests marker present', () => {
      assertPresent('after-all-break-tests')
    })
  })
})
