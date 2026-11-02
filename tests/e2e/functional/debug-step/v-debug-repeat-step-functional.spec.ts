/**
 * V-DEBUG-REPEAT-STEP-FUNCTIONAL: Repeat Step end-to-end with fail-then-pass
 *
 * Scenario:
 *   Try-Catch wrapping a plugin that fails on first attempt but passes on
 *   retry (variable-controlled fail-once: the http-echo service's stateful
 *   /timeout endpoint is armed before the workflow runs; the first request
 *   times out and the endpoint is disarmed for the retry). Pause-on-errors
 *   enabled. Debug run -> pauses on the failing HTTP node with reason=error.
 *   Repeat Step -> plugin re-runs, the endpoint responds instantly, engine
 *   re-pauses on the same block with passed badge (reason=step_complete).
 *   Continue -> the catch branch is NOT triggered (final-attempt-wins).
 *
 * Verifies that variable / runtime writes from the latest attempt commit
 * ("writes stick") and that Continue routes through the success
 * egress when the most recent attempt passed ("final-attempt-wins").
 *
 * REQ: REQ-3.2.1.4 (Block re-execution during pause)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { getLogTexts, getLogLines } from '../../helpers/log-reader'
import {
  importAndNavigate,
  selectEnvironment,
  setDebugOption,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickRepeatStep,
  armHttpsTimeout,
  getNodeExecStatus,
} from './helpers'
import fs from 'fs'
import path from 'path'

function loadFixture(timeoutKey: string): Record<string, unknown> {
  const raw = fs.readFileSync(
    path.resolve(__dirname, 'fixture-repeat-step.json'),
    'utf-8',
  )
  const fixture = JSON.parse(raw) as Record<string, unknown> & {
    variables: Record<string, { value: unknown }>
  }
  fixture.variables.timeout_key.value = timeoutKey
  return fixture
}

test.describe('V-DEBUG-REPEAT-STEP: Repeat Step on a fail-then-pass plugin', () => {
  test('Repeat Step re-runs the failed HTTP, badge flips to passed, Continue takes the then path', async ({
    page,
  }, testInfo) => {
    // Use a per-test-run unique key so parallel workers and re-runs of this
    // spec each get fresh per-key state on the shared http-echo service
    // (/timeout/arm stores per-key arm flags in-memory).
    const timeoutKey = `v-debug-repeat-${testInfo.parallelIndex}-${Date.now()}`

    await armHttpsTimeout(page.request, timeoutKey)

    await importAndNavigate(page, loadFixture(timeoutKey), { injectHttp: true })

    // pause_on_errors is the trigger for the first pause - the HTTP plugin
    // will time out and the engine pauses AT the failing node.
    await setDebugOption(page, 'errors', true)

    await selectEnvironment(page)
    await startDebugRun(page)

    // First pause - HTTP node, reason=error. Note: the engine pauses
    // INSIDE try_catch.py's exception handler BEFORE block_states is
    // updated to "failed" (see try_catch.py:_execute_single_path_node).
    // So while paused-on-error, data-execution-status is still 'running'
    // (the value set when the node started executing). The badge only
    // flips to 'failed' on Continue; if the user clicks Repeat first, it
    // flips to 'failed' or 'success' depending on the re-run outcome.
    await expectPausedAt(page, 'http-flake', 30_000)

    const linesAfterError = await getLogLines(page)
    expect(
      linesAfterError.some((l) => l.includes('⏸ Paused on error at Flaky HTTP')),
      `Expected "⏸ Paused on error at Flaky HTTP". Got: ${linesAfterError.join(' | ')}`,
    ).toBeTruthy()
    // Catch path log MUST NOT have run before Repeat / Continue.
    const logsBeforeRepeat = await getLogTexts(page)
    expect(
      logsBeforeRepeat.some((m) => m.includes('tc-caught')),
      `"tc-caught" must not be in Console before Repeat / Continue. Got: ${logsBeforeRepeat.join(' | ')}`,
    ).toBeFalsy()

    // Repeat Step - same node re-runs. The endpoint was disarmed by the first
    // call, so this request returns instantly with 200.
    await clickRepeatStep(page)

    // Re-pause is on the same node with badge flipped to success.
    // The status flips to 'paused' again with reason=step_complete.
    await expectPausedAt(page, 'http-flake', 15_000)
    await expect
      .poll(
        async () => getNodeExecStatus(page, 'http-flake'),
        { timeout: 5_000 },
      )
      .toBe('success')

    // Continue routes through the THEN egress (catch-path was not taken
    // because the last attempt passed - final-attempt-wins).
    await clickContinue(page)
    await waitForStatus(page, 'passed', 15_000)

    const finalLogs = await getLogTexts(page)
    expect(
      finalLogs.some((m) => m.includes('tc-passed')),
      `Expected "tc-passed" in Console after Continue. Got: ${finalLogs.join(' | ')}`,
    ).toBeTruthy()
    expect(
      finalLogs.some((m) => m.includes('tc-caught')),
      `"tc-caught" should not appear because the final attempt passed. Got: ${finalLogs.join(' | ')}`,
    ).toBeFalsy()
  })
})
