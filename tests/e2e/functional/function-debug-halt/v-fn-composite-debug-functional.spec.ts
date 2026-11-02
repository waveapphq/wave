/**
 * V-FN-COMPOSITE-DEBUG (functional): step debugging treats a Function
 * instance as a single-egress composite - the same shape the step debugger
 * already applies to loop / try-catch parents (REQ-3.2.1.3, REQ-3.2.1.4).
 *
 * One fixture (`fixture-composite-debug.json`): a local Function_1 whose body
 * is A -> B, followed by an after-Log on the caller canvas. Each test drives a
 * fresh debug run paused on the Function node and exercises one verb:
 *
 *   - Step Over: runs the whole body atomically (A + B log), re-pauses on the
 *     sibling-after node; the after-Log has not run yet.
 *   - Step Into: descends into the body, the canvas auto-drills, and
 *     re-pauses on the first inner node BEFORE it runs (A not logged yet).
 *   - Skip Block: a Function is single-egress, so Skip routes past the whole
 *     body (no diverging 409) to the sibling-after; the body never runs.
 *   - Repeat Step: re-invokes the body and re-pauses in place on the Function
 *     node - each Repeat runs the body once more.
 *
 * Contracts mirrored from backend `test_workbench_function_step_debug.py`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts } from '../../helpers/log-reader'
import {
  importAndNavigate,
  selectEnvironment,
  toggleBreakpoint,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickStepOver,
  clickStepInto,
  clickSkipBlock,
  clickRepeatStep,
  getNodeExecStatus,
} from './helpers'
import fs from 'fs'
import path from 'path'

const FN = 'fn-1'

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture-composite-debug.json'), 'utf-8'))
}

async function debugToPausedFunction(page: Page): Promise<void> {
  await importAndNavigate(page, loadFixture())
  await toggleBreakpoint(page, FN)
  await selectEnvironment(page)
  await startDebugRun(page)
  await expectPausedAt(page, FN)
}

test.describe('V-FN-COMPOSITE-DEBUG (functional): step a Function as a single-egress composite', () => {
  test('Step Over runs the whole body atomically and pauses on the sibling-after', async ({ page }) => {
    await debugToPausedFunction(page)

    // Paused on the Function before its body runs - no body markers yet.
    const before = await getLogTexts(page)
    expect(before.some((m) => m.includes('fn-A')), `body must not run before Step Over: ${before.join(' | ')}`).toBe(false)

    await clickStepOver(page)

    // The whole body ran; the engine re-pauses on the after-Log (not yet run).
    await expectPausedAt(page, 'after')
    const after = await getLogTexts(page)
    expect(after.some((m) => m.includes('fn-A')), `A must log after Step Over: ${after.join(' | ')}`).toBe(true)
    expect(after.some((m) => m.includes('fn-B')), `B must log after Step Over: ${after.join(' | ')}`).toBe(true)
    expect(after.some((m) => m.includes('fn-after')), 'after-Log is the pause target - must not have run').toBe(false)
    expect(await getNodeExecStatus(page, FN)).toBe('success')

    await clickContinue(page)
    await waitForStatus(page, 'passed')
    expect((await getLogTexts(page)).some((m) => m.includes('fn-after'))).toBe(true)
  })

  test('Step Into descends into the body, auto-drills, and pauses on the first inner node', async ({ page }) => {
    await debugToPausedFunction(page)

    await clickStepInto(page)

    // The canvas auto-drilled to the body and the engine paused on
    // the first inner node BEFORE it ran. data-paused on inner-a proves the
    // canvas followed execution into the Function body.
    await expectPausedAt(page, 'inner-a')
    const atInner = await getLogTexts(page)
    expect(atInner.some((m) => m.includes('fn-A')), `paused BEFORE the first inner node runs: ${atInner.join(' | ')}`).toBe(false)

    await clickContinue(page)
    await waitForStatus(page, 'passed')
    const finalLogs = await getLogTexts(page)
    for (const marker of ['fn-A', 'fn-B', 'fn-after']) {
      expect(finalLogs.some((m) => m.includes(marker)), `"${marker}" missing after Continue: ${finalLogs.join(' | ')}`).toBe(true)
    }
  })

  test('Skip Block routes past the whole Function body without running it', async ({ page }) => {
    await debugToPausedFunction(page)

    await clickSkipBlock(page)

    // Single-egress: skip re-pauses on the sibling-after; the body never ran.
    await expectPausedAt(page, 'after')
    const logs = await getLogTexts(page)
    expect(logs.some((m) => m.includes('fn-A')), `body must NOT run when the Function is skipped: ${logs.join(' | ')}`).toBe(false)
    expect(logs.some((m) => m.includes('fn-B')), 'body must NOT run when the Function is skipped').toBe(false)
    // A runtime Skip Block is a structural skip (the body never ran), so the node is
    // marked skipped without the intentional-skip SKIP badge (reserved for a Halt result).
    await expect(page.locator(`[data-testid="workflow-node-${FN}"]`)).toHaveAttribute('data-execution-status', 'skipped')

    await clickContinue(page)
    await waitForStatus(page, 'passed')
    expect((await getLogTexts(page)).some((m) => m.includes('fn-after')), 'flow continues to the sibling-after').toBe(true)
  })

  test('Repeat Step re-invokes the body and re-pauses in place on the Function', async ({ page }) => {
    await debugToPausedFunction(page)

    const bodyRuns = async () => (await getLogTexts(page)).filter((m) => m.includes('fn-A')).length

    // Paused before the Function is invoked - body has not run.
    expect(await bodyRuns()).toBe(0)

    await clickRepeatStep(page)
    await expectPausedAt(page, FN)
    await expect.poll(bodyRuns, { timeout: 15_000 }).toBeGreaterThanOrEqual(1)

    await clickRepeatStep(page)
    await expectPausedAt(page, FN)
    await expect.poll(bodyRuns, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)

    await clickContinue(page)
    await waitForStatus(page, 'passed')
  })
})
