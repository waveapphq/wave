/**
 * V-FN-HALT-SCOPE (functional): a function-scope Halt is absorbed at the
 * innermost Function boundary (REQ-3.5.1.14). One workflow, all three
 * outcomes:
 *
 *   log-before -> FnPassed -> FnSkipped -> Try/Catch{ try: FnFailed,
 *                 catch: log-caught } -> log-after
 *
 *   - FnPassed   (Halt function/passed):  caller continues, node badge PASS.
 *   - FnSkipped  (Halt function/skipped): caller continues, node badge SKIP.
 *   - FnFailed   (Halt function/failed) inside the try-branch: raises, the
 *     Try/Catch catches it (catch path runs), the then-egress continues, and
 *     the node badge is FAIL. The failure never drains past the Function /
 *     Try/Catch, so the session still passes.
 *
 * Proves passed/skipped do NOT raise (caller flow proceeds) while failed DOES
 * raise but is catchable - the contract from backend `test_executor.py` /
 * `test_workbench_function_runs.py`, observed end-to-end at the UI.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import { importAndNavigate, selectEnvironment, startRun, waitForStatus, getRunStateBadge } from './helpers'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-halt-scopes.json'), 'utf-8'))
}

test.describe('V-FN-HALT-SCOPE (functional): function-scope Halt absorbed at the boundary', () => {
  test('passed/skipped continue with the right badge; failed is caught by Try/Catch', async ({ page }) => {
    await importAndNavigate(page, loadFixture())
    await selectEnvironment(page)
    await startRun(page)

    // Every function-scope Halt is absorbed/caught, so the session passes.
    await waitForStatus(page, 'passed', 60_000)

    const logs = await getLogTexts(page)

    await test.step('FnPassed: caller continues, PASS badge', async () => {
      expect(logs.some((m) => m.includes('halt-before')), `flow started: ${logs.join(' | ')}`).toBe(true)
      expect(await getRunStateBadge(page, 'fn-passed')).toBe('pass')
    })

    await test.step('FnSkipped: caller continues, SKIP badge', async () => {
      expect(await getRunStateBadge(page, 'fn-skipped')).toBe('skip')
    })

    await test.step('FnFailed inside Try/Catch: FAIL badge, catch path runs, then-egress continues', async () => {
      expect(await getRunStateBadge(page, 'fn-failed')).toBe('fail')
      expect(logs.some((m) => m.includes('halt-caught')), `catch path must run: ${logs.join(' | ')}`).toBe(true)
      expect(logs.some((m) => m.includes('halt-after')), `then-egress continues past Try/Catch: ${logs.join(' | ')}`).toBe(true)
    })
  })
})
