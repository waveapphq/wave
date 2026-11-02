/**
 * V-CTRL-FOREACH-FUNCTIONAL: ForEach Control End-to-End Execution Test
 *
 * Single workflow chaining eight ForEach loops to cover all permutations:
 *   1. ForEach(array): body executes 3 times for ["alpha", "bravo", "charlie"]
 *   2. ForEach(empty): body skipped entirely (0 iterations)
 *   3. ForEach(map): body executes 2 times for keys ["host", "port"]
 *   4. ForEach(table): body executes 2 times for the rows of a variable DECLARED
 *      table, bound the way the picker binds one (a literal variable reference)
 *   5. ForEach(literal): body executes 3 times for literal array ["x", "y", "z"] (no expression)
 *   6. ForEach(empty map): body skipped entirely (0 iterations)
 *   7. ForEach(empty table): body skipped entirely (0 iterations)
 *   8. ForEach(timeout): 10-item list with 200ms delay body, 1s timeout - partial execution
 *      wrapped in a try-catch so the timeout error is caught and the workflow passes
 *
 * Chain: log-before -> foreach-array -> foreach-empty -> foreach-map -> foreach-table
 *        -> foreach-literal -> foreach-empty-map -> foreach-empty-table -> log-after
 *        -> tc-timeout (try -> foreach-timeout)
 *
 * Workflow status is "passed" because the try-catch catches the timeout error.
 *
 * A second workflow proves the rejection: a collection that resolves to a number
 * fails the run with the exact contract message.
 *
 * REQ: REQ-3.5.1.16
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { BACKEND_PORT, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

function loadFixture(name = 'fixture'): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, `${name}.json`), 'utf-8'))
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

test.describe('ForEach Control E2E Execution', () => {

  test('Eight chained ForEach loops: array, empty, map, table, literal, empty map, empty table, timeout', async ({ page }) => {
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
    // Timeout ForEach has 1s timeout, allow extra time for full workflow completion
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    const statusVal = await status.getAttribute('data-status')
    const logs = await getLogTexts(page)
    const logEntries = await getLogLines(page)
    const all = logs.join('\n')

    // Always dump diagnostics for debugging
    dumpDiagnostics(statusVal, await getNodeStatuses(page), logEntries)

    // Workflow ends as "passed" because the timeout ForEach is wrapped in a try-catch.
    expect(statusVal, `Expected 'passed' (try-catch catches timeout), got '${statusVal}'`).toBe('passed')

    // --- ForEach(array): 3 iterations over ["alpha", "bravo", "charlie"] ---
    await test.step('ForEach array: 3 iterations with typed envelope', () => {
      expect(logs.some((t) => t.includes('before-foreach')), `Missing 'before-foreach'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-array-alpha')), `Missing 'foreach-array-alpha'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-array-bravo')), `Missing 'foreach-array-bravo'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-array-charlie')), `Missing 'foreach-array-charlie'\n${all}`).toBeTruthy()
      // No 4th iteration
      expect(logs.some((t) => t.match(/foreach-array-/) && !t.includes('alpha') && !t.includes('bravo') && !t.includes('charlie')),
        'Unexpected extra foreach-array iteration').toBeFalsy()
    })

    // --- ForEach(empty): 0 iterations, body never executes ---
    await test.step('ForEach empty: body skipped entirely', () => {
      // The halt-trap in the body should never execute; if it did, status would show it
      expect(logs.some((t) => t.includes('empty body executed')),
        'Empty ForEach body executed - BUG').toBeFalsy()
    })

    // --- ForEach(map): 2 iterations over keys ["host", "port"] ---
    await test.step('ForEach map: iterates over dict keys', () => {
      expect(logs.some((t) => t.includes('foreach-map-host')), `Missing 'foreach-map-host'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-map-port')), `Missing 'foreach-map-port'\n${all}`).toBeTruthy()
      // No 3rd iteration
      expect(logs.some((t) => t.match(/foreach-map-/) && !t.includes('host') && !t.includes('port')),
        'Unexpected extra foreach-map iteration').toBeFalsy()
    })

    // --- ForEach(table): 2 iterations over the rows of a declared table variable ---
    await test.step('ForEach table: iterates over the rows of a declared table variable', () => {
      expect(logs.some((t) => t.includes('foreach-table-srv-a')), `Missing 'foreach-table-srv-a'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-table-srv-b')), `Missing 'foreach-table-srv-b'\n${all}`).toBeTruthy()
      // No 3rd row
      expect(logs.some((t) => t.match(/foreach-table-/) && !t.includes('srv-a') && !t.includes('srv-b')),
        'Unexpected extra foreach-table iteration').toBeFalsy()
    })

    // --- ForEach(literal): 3 iterations over literal array ["x", "y", "z"] ---
    await test.step('ForEach literal: iterates over literal array (no expression)', () => {
      expect(logs.some((t) => t.includes('foreach-literal-x')), `Missing 'foreach-literal-x'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-literal-y')), `Missing 'foreach-literal-y'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-literal-z')), `Missing 'foreach-literal-z'\n${all}`).toBeTruthy()
      // No 4th item
      expect(logs.some((t) => t.match(/foreach-literal-/) && !t.includes('-x') && !t.includes('-y') && !t.includes('-z')),
        'Unexpected extra foreach-literal iteration').toBeFalsy()
    })

    // --- ForEach(empty map / empty table): 0 iterations, bodies never execute ---
    await test.step('ForEach empty map and empty table: bodies skipped entirely', () => {
      expect(logs.some((t) => t.includes('empty map body executed')),
        'Empty map ForEach body executed - BUG').toBeFalsy()
      expect(logs.some((t) => t.includes('empty table body executed')),
        'Empty table ForEach body executed - BUG').toBeFalsy()
    })

    // --- Log After: proves then-path continuation for non-timeout ForEach nodes ---
    await test.step('Log After: then-path continuation works', () => {
      expect(logs.some((t) => t.includes('after-all-foreach')), `Missing 'after-all-foreach'\n${all}`).toBeTruthy()
    })

    // --- ForEach(timeout): partial execution, caught by try-catch ---
    await test.step('ForEach timeout: partial iterations caught by try-catch', () => {
      // With 200ms delay per iteration and 1s timeout:
      // - ~4-5 iterations complete out of 10
      expect(logs.some((t) => t.includes('foreach-timeout-0')), `Missing 'foreach-timeout-0'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-timeout-1')), `Missing 'foreach-timeout-1'\n${all}`).toBeTruthy()
      expect(logs.some((t) => t.includes('foreach-timeout-2')), `Missing 'foreach-timeout-2'\n${all}`).toBeTruthy()

      // Items 8-9 definitely should NOT have executed
      expect(logs.some((t) => t.includes('foreach-timeout-8')), 'foreach-timeout-8 should NOT exist').toBeFalsy()
      expect(logs.some((t) => t.includes('foreach-timeout-9')), 'foreach-timeout-9 should NOT exist').toBeFalsy()

      // Catch path executed - the try-catch caught the timeout error
      expect(logs.some((t) => t.includes('foreach-timeout-caught')),
        `Missing 'foreach-timeout-caught' - catch path did not execute\n${all}`).toBeTruthy()
    })
  })

  test('A collection that is not a collection fails the run with the contract message', async ({ page }) => {
    test.setTimeout(120_000)
    await importValidateAndNavigate(page, loadFixture('non-collection.fixture'))

    await selectEnvironment(page, E2E_ENV_NAME)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).not.toHaveAttribute('data-status', 'idle', { timeout: 10_000 })
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 30_000 })

    const statusVal = await status.getAttribute('data-status')
    const logEntries = await getLogLines(page)
    dumpDiagnostics(statusVal, await getNodeStatuses(page), logEntries)

    expect(statusVal, `Expected 'failed', got '${statusVal}'`).toBe('failed')
    await expect(page.locator('[data-testid="workflow-node-foreach-bad"]')).toHaveAttribute(
      'data-execution-status',
      'failed',
    )

    // The collection is a variable reference, so the resolution layer type-checks
    // it before the control runs and reports the mismatch itself. The control's
    // own `collection must be a list, dict, or table` message is asserted by the
    // backend unit tests, which reach it directly.
    const expected = "Parameter 'collection' expects array/map/table, got int"
    expect(
      logEntries.some((l) => l.includes(expected)),
      `Expected console ERROR containing:\n  ${expected}\nGot:\n${logEntries.join('\n')}`,
    ).toBeTruthy()

    // The body must never run for a rejected collection.
    const texts = await getLogTexts(page)
    expect(
      texts.some((t) => t.includes('non-collection body executed')),
      'Body executed for a rejected collection - BUG',
    ).toBeFalsy()
  })
})
