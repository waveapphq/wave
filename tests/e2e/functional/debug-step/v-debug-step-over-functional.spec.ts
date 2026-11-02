/**
 * V-DEBUG-STEP-OVER-FUNCTIONAL: Step Over end-to-end across a For-Loop
 *
 * Scenario:
 *   For-Loop with three iterations each logging "iter-{i}", followed by a
 *   Log "after-loop". Breakpoint on the For-Loop. Debug run -> pauses at
 *   For-Loop. Step Over -> expects three iter-N log entries in Console AND
 *   engine pauses at the "after-loop" Log node. Continue -> session passes.
 *
 * Verifies the Step Over semantics on a control-flow parent: the entire
 * sub-graph (body iterations) executes atomically, then the engine
 * re-pauses on the sibling-after node via pause_at_next_node.
 *
 * REQ: REQ-3.2.1.3 (Step-by-step execution: step-over)
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
  clickStepOver,
  getNodeExecStatus,
} from './helpers'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-step-loop.json'), 'utf-8'),
  )
}

test.describe('V-DEBUG-STEP-OVER: Step Over across a For-Loop', () => {
  test('Step Over runs all iterations atomically and pauses on the after-loop Log', async ({
    page,
  }) => {
    await importAndNavigate(page, loadFixture())

    await toggleBreakpoint(page, 'for-loop')

    await selectEnvironment(page)
    await startDebugRun(page)

    // Pause BEFORE the For-Loop runs - body has not executed yet.
    await expectPausedAt(page, 'for-loop')
    const logsBefore = await getLogTexts(page)
    expect(
      logsBefore.some((m) => m.startsWith('iter-')),
      `No iter-N markers should exist before Step Over. Got: ${logsBefore.join(' | ')}`,
    ).toBeFalsy()

    await clickStepOver(page)

    // Step Over runs the loop atomically and re-pauses on the after-loop Log.
    await expectPausedAt(page, 'after-log')

    const logsAfter = await getLogTexts(page)
    expect(
      logsAfter.some((m) => m.includes('iter-0')),
      `Expected "iter-0" in Console after Step Over. Got: ${logsAfter.join(' | ')}`,
    ).toBeTruthy()
    expect(
      logsAfter.some((m) => m.includes('iter-1')),
      `Expected "iter-1" in Console after Step Over. Got: ${logsAfter.join(' | ')}`,
    ).toBeTruthy()
    expect(
      logsAfter.some((m) => m.includes('iter-2')),
      `Expected "iter-2" in Console after Step Over. Got: ${logsAfter.join(' | ')}`,
    ).toBeTruthy()
    // The after-loop Log is the pause target - it must NOT have run yet.
    expect(
      logsAfter.some((m) => m.includes('after-loop')),
      `"after-loop" must not be in Console while paused on it. Got: ${logsAfter.join(' | ')}`,
    ).toBeFalsy()

    // The For-Loop control itself shows success after the body completed.
    expect(await getNodeExecStatus(page, 'for-loop')).toBe('success')

    // Console should record the post-step pause line (reason="step").
    const lines = await getLogLines(page)
    expect(
      lines.some((l) => l.includes('⏸') && l.includes('After Loop') && l.includes('(step)')),
      `Expected "⏸ Paused at After Loop (step)". Got: ${lines.join(' | ')}`,
    ).toBeTruthy()

    await clickContinue(page)
    await waitForStatus(page, 'passed')

    const finalLogs = await getLogTexts(page)
    expect(
      finalLogs.some((m) => m.includes('after-loop')),
      `"after-loop" should be logged after final Continue. Got: ${finalLogs.join(' | ')}`,
    ).toBeTruthy()
  })
})
