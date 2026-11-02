/**
 * V-DEBUG-STEP-INTO-FUNCTIONAL: Step Into end-to-end across a For-Loop
 *
 * Scenario:
 *   Same workflow as Step Over (For-Loop count=3 + after-loop Log).
 *   Breakpoint on the For-Loop. Debug run -> pauses. Step Into -> engine
 *   pauses at the FIRST body node BEFORE any iter log is written. Continue
 *   -> the loop runs to completion and the after-loop Log appears.
 *
 * Verifies the Step Into semantics on a control-flow parent: descend into
 * the body sub-graph and re-pause BEFORE the first body node executes.
 *
 * REQ: REQ-3.2.1.3 (Step-by-step execution: step-into)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import {
  importAndNavigate,
  selectEnvironment,
  toggleBreakpoint,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickStepInto,
} from './helpers'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-step-loop.json'), 'utf-8'),
  )
}

test.describe('V-DEBUG-STEP-INTO: Step Into descends into the loop body', () => {
  test('Step Into pauses on the first body node before any iter is logged', async ({
    page,
  }) => {
    await importAndNavigate(page, loadFixture())

    await toggleBreakpoint(page, 'for-loop')

    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'for-loop')

    await clickStepInto(page)

    // Step Into descends into the body and pauses BEFORE the first body
    // node runs - no iter markers in the Console yet.
    await expectPausedAt(page, 'body-log')

    const logsAfterStep = await getLogTexts(page)
    expect(
      logsAfterStep.some((m) => m.startsWith('iter-')),
      `No iter-N markers should exist after Step Into pauses BEFORE body. Got: ${logsAfterStep.join(' | ')}`,
    ).toBeFalsy()

    // Console pause line for Step Into is reason="step" - the step trigger
    // is consumed by the first non-skipped node visited.
    const lines = await getLogLines(page)
    expect(
      lines.some((l) => l.includes('⏸') && l.includes('Body Log') && l.includes('(step)')),
      `Expected "⏸ Paused at Body Log (step)". Got: ${lines.join(' | ')}`,
    ).toBeTruthy()

    // Continue lets the loop and after-log run to completion.
    await clickContinue(page)
    await waitForStatus(page, 'passed')

    const finalLogs = await getLogTexts(page)
    for (const marker of ['iter-0', 'iter-1', 'iter-2', 'after-loop']) {
      expect(
        finalLogs.some((m) => m.includes(marker)),
        `"${marker}" missing from Console after Continue. Got: ${finalLogs.join(' | ')}`,
      ).toBeTruthy()
    }
  })
})
