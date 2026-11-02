/**
 * V-CTRL-CONTINUE-FUNCTIONAL: Continue Control End-to-End Execution Test
 *
 * Eight continue scenarios in a single workflow:
 *   S1: For(count=3) + continue (tests 14, 18)
 *   S2: ForEach(3 items) + continue (test 15)
 *   S3: While(counter<3) + continue (test 16)
 *   S4: For(count=3) + continue as first node (test 17)
 *   S5: Nested For>ForEach, continue targets inner (test 19)
 *   S6: Nested For>ForEach, continue targets outer (test 20)
 *   S7: Continue inside try-catch in loop (test 21)
 *   S8: Continue inside if-else true branch in loop (test 22)
 *
 * REQ: REQ-3.5.1.3
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

test.describe('Continue Control E2E Execution', () => {

  test('Eight continue scenarios covering single-loop, nested, and controls', async ({ page }) => {
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

    // --- S1: For(count=3), continue skips rest of body, all iterations run ---
    await test.step('S1: For(count=3) + continue - all iterations run', () => {
      assertPresent('before-continue-tests')
      assertPresent('cont-s1-0')
      assertPresent('cont-s1-1')
      assertPresent('cont-s1-2')
      assertAbsent('cont-s1-never')
      assertPresent('cont-s1-then')
    })

    // --- S2: ForEach(["a","b","c"]), continue in body ---
    await test.step('S2: ForEach(3 items) + continue - all items iterated', () => {
      assertPresent('cont-s2-0')
      assertPresent('cont-s2-1')
      assertPresent('cont-s2-2')
      assertAbsent('cont-s2-never')
      assertPresent('cont-s2-then')
    })

    // --- S3: While(c_s3 < 3), varset increments before continue ---
    await test.step('S3: While(counter<3) + continue - counter incremented before log', () => {
      assertPresent('cont-s3-1')
      assertPresent('cont-s3-2')
      assertPresent('cont-s3-3')
      assertAbsent('cont-s3-never')
      assertPresent('cont-s3-then')
    })

    // --- S4: Continue as first body node - zero work per iteration ---
    await test.step('S4: Continue as first body node - zero work', () => {
      assertAbsent('cont-s4-never')
      assertPresent('cont-s4-then')
    })

    // --- S5: Nested For>ForEach, continue targets INNER - all items iterated ---
    await test.step('S5: Nested continue targets inner - all items iterated', () => {
      assertPresent('cont-s5-inner-0')
      assertPresent('cont-s5-inner-1')
      assertAbsent('cont-s5-inner-never')
      assertPresent('cont-s5-inner-then')
      assertPresent('cont-s5-outer-done')
    })

    // --- S6: Nested For>ForEach, continue targets OUTER - inner exits, outer advances ---
    await test.step('S6: Nested continue targets outer - inner exits on first item', () => {
      assertPresent('cont-s6-inner-0')
      assertAbsent('cont-s6-inner-1')
      assertAbsent('cont-s6-inner-never')
      assertAbsent('cont-s6-inner-then-never')
      assertPresent('cont-s6-outer-done')
    })

    // --- S7: Continue inside try-catch ---
    await test.step('S7: Continue inside try-catch in loop', () => {
      assertPresent('cont-s7-try-0')
      assertPresent('cont-s7-try-1')
      assertPresent('cont-s7-try-2')
      assertAbsent('cont-s7-catch-never')
      assertPresent('cont-s7-for-then')
    })

    // --- S8: Continue inside if-else true branch ---
    await test.step('S8: Continue inside if-else true branch', () => {
      assertPresent('cont-s8-true-0')
      assertPresent('cont-s8-true-1')
      assertPresent('cont-s8-true-2')
      assertAbsent('cont-s8-else-never')
      assertPresent('cont-s8-for-then')
    })

    // --- Final: after all continue tests ---
    await test.step('Final: after-all-continue-tests marker present', () => {
      assertPresent('after-all-continue-tests')
    })
  })
})
