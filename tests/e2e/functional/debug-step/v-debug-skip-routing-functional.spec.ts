/**
 * V-DEBUG-SKIP-ROUTING-FUNCTIONAL: Skip Block routes past a single-egress
 * control to the 'then' egress and cascade-marks the body as skipped.
 *
 * Scenario:
 *   For-Loop with body Log "inside-body" then Log "after-loop". Breakpoint
 *   on the For-Loop. Debug run -> pauses at For-Loop. Skip Block -> the
 *   body sub-graph is marked skipped, no "inside-body" log entries appear,
 *   and the engine pauses at the after-loop Log via the step-trigger that
 *   propagates past skipped nodes.
 *
 * REQ: REQ-3.2.2.2 (Skip blocks during runtime - single-egress cascade)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  importAndNavigate,
  selectEnvironment,
  toggleBreakpoint,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickSkipBlock,
  getNodeExecStatus,
} from './helpers'
import fs from 'fs'
import path from 'path'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-skip-routing.json'), 'utf-8'),
  )
}

test.describe('V-DEBUG-SKIP-ROUTING: Skip Block at For-Loop pause', () => {
  test('Skip Block cascades over the body and pauses on after-loop with the body marked skipped', async ({
    page,
  }) => {
    await importAndNavigate(page, loadFixture())

    await toggleBreakpoint(page, 'for-loop')

    await selectEnvironment(page)
    await startDebugRun(page)

    await expectPausedAt(page, 'for-loop')

    await clickSkipBlock(page)

    // Engine cascades the skip mark to the body sub-graph and re-pauses at
    // the after-loop Log via pause_at_next_node.
    await expectPausedAt(page, 'after-log')
    expect(await getNodeExecStatus(page, 'for-loop')).toBe('skipped')
    expect(await getNodeExecStatus(page, 'body-log')).toBe('skipped')

    const logsAfterSkip = await getLogTexts(page)
    expect(
      logsAfterSkip.some((m) => m.includes('inside-body')),
      `"inside-body" must NOT be in Console after skipping the For-Loop body. Got: ${logsAfterSkip.join(' | ')}`,
    ).toBeFalsy()
    expect(
      logsAfterSkip.some((m) => m.includes('after-loop')),
      `"after-loop" must not be in Console while paused on it. Got: ${logsAfterSkip.join(' | ')}`,
    ).toBeFalsy()

    // Continue runs the after-loop Log and the session terminates passed.
    await clickContinue(page)
    await waitForStatus(page, 'passed')

    const finalLogs = await getLogTexts(page)
    expect(
      finalLogs.some((m) => m.includes('after-loop')),
      `"after-loop" should be logged after Continue. Got: ${finalLogs.join(' | ')}`,
    ).toBeTruthy()
    expect(
      finalLogs.some((m) => m.includes('inside-body')),
      `"inside-body" must remain skipped at terminal. Got: ${finalLogs.join(' | ')}`,
    ).toBeFalsy()
  })
})
