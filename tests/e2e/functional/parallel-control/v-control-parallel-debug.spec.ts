/**
 * V-CONTROL-PARALLEL-DEBUG: debugging a Parallel section end-to-end
 *
 * Design Decisions: PARALLEL-8
 * REQ: REQ-3.2.3.9 (a debug pause parks the whole parallel section)
 *
 * Debugging keeps one cursor. The first branch to hit a trigger becomes the
 * paused block; every sibling parks at its next block boundary. Step drives the
 * paused branch alone, Continue releases the section, and a branch that is
 * stepped off its last block must release the section rather than hold it.
 *
 * The sibling branch bumps `b_count` four times, so "the sibling is parked" is
 * proven by the counter rather than by timing.
 *
 * Pass Criteria:
 *  D1  A breakpoint inside a branch parks the section - while paused the sibling
 *      has advanced at most one block (`b_count <= 1`)
 *  D2  Continue releases every parked branch - the run passes, `b_count == 4`,
 *      and the exit lane logs EXIT exactly once
 *  D3  Step Over re-pauses on that branch's next block
 *  D4  Step Over does not release the parked sibling - `b_count` is unchanged
 *  D5  Step Over off the LAST block of a branch releases the section instead of
 *      hanging it: the cursor moves to the sibling and the run reaches a
 *      terminal status
 *  D6  Step Into advances the paused branch and leaves siblings parked
 *  D7  Skip Block marks the block skipped, re-pauses on that branch's next
 *      block, and leaves the sibling parked
 *  D8  Two breakpoints in different branches surface one after another
 *  D9  The Parallel block keeps its running treatment while a branch is paused
 *  D10 A debug run stepped to completion ends in the same state as a plain run
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { getLogTexts, waitForLogText } from '../../helpers/log-reader'
import { getActiveSessionId, getSessionVariables } from '../../helpers/fixture-import'
import {
  importAndNavigate,
  selectEnvironment,
  toggleBreakpoint,
  setDebugOption,
  startDebugRun,
  expectPausedAt,
  waitForStatus,
  clickContinue,
  clickStepOver,
  clickStepInto,
  clickSkipBlock,
  getNodeExecStatus,
} from '../debug-step/helpers'
import fs from 'fs'
import path from 'path'

/** Long enough that an unparked sibling would finish its whole four-block chain. */
const PARK_SETTLE_MS = 800

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'debug-fixture.json'), 'utf-8'))
}

async function readCounter(page: Page): Promise<number> {
  const sessionId = await getActiveSessionId(page)
  const vars = await getSessionVariables(page, sessionId)
  return Number(vars.b_count?.value ?? -1)
}

/** Open the fixture, arm the debugger and pause on the first block of branch 1. */
async function pauseInsideBranchOne(page: Page): Promise<void> {
  await importAndNavigate(page, loadFixture())
  await toggleBreakpoint(page, 'delay-b1')
  // An armed pause-on-first would park on the Parallel itself, not in a branch.
  await setDebugOption(page, 'first', false)
  await selectEnvironment(page)
  await startDebugRun(page)
  await expectPausedAt(page, 'delay-b1')
}

/** The paused block's node id, read off the canvas. */
async function pausedNodeId(page: Page): Promise<string> {
  const testId = await page
    .locator('[data-testid^="workflow-node-"][data-paused="true"]')
    .first()
    .getAttribute('data-testid')
  return (testId ?? '').replace('workflow-node-', '')
}

test.describe('V-CONTROL-PARALLEL-DEBUG: a paused branch parks its section', () => {
  test('D1, D9, D3, D4, D2: park, step within the branch, then release', async ({ page }) => {
    await pauseInsideBranchOne(page)

    await test.step('D1: the sibling advances at most one block while the section is parked', async () => {
      // Measuring "nothing happened" needs real time to pass.
      await page.waitForTimeout(PARK_SETTLE_MS)
      const parked = await readCounter(page)
      expect(parked, 'a parked sibling stops at its next block boundary').toBeLessThanOrEqual(1)
    })

    await test.step('D9: the Parallel itself keeps its running treatment', async () => {
      expect(await getNodeExecStatus(page, 'par-dbg')).toBe('running')
    })

    const beforeStep = await readCounter(page)

    await test.step('D3: Step Over re-pauses on the branch next block', async () => {
      await clickStepOver(page)
      await expectPausedAt(page, 'log-b1')
      // The pause is BEFORE the block, so its marker has not been logged yet.
      const logs = await getLogTexts(page)
      expect(
        logs.some((t) => t === 'B1'),
        `"B1" must not be logged while paused on it. Got: ${logs.join(' | ')}`,
      ).toBeFalsy()
    })

    await test.step('D4: the step did not release the parked sibling', async () => {
      await page.waitForTimeout(PARK_SETTLE_MS)
      expect(
        await readCounter(page),
        'Step is not Continue - the sibling holds where it was',
      ).toBe(beforeStep)
    })

    await test.step('D2: Continue releases every parked branch', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed', 30_000)
      await waitForLogText(page, 'EXIT')
      const logs = await getLogTexts(page)
      expect(
        logs.filter((t) => t === 'EXIT').length,
        `The exit lane runs once. Got: ${logs.join(' | ')}`,
      ).toBe(1)
      expect(await readCounter(page), 'every parked block runs after Continue').toBe(4)
    })
  })

  test('D5, D10: stepping off the last block of a branch releases the section', async ({
    page,
  }) => {
    await pauseInsideBranchOne(page)

    await clickStepOver(page)
    await expectPausedAt(page, 'log-b1')

    // log-b1 is the last block of branch 1. Stepping off it ends that branch's
    // walk while the step is still armed - the section has to carry on anyway.
    await clickStepOver(page)

    await test.step('D5: the cursor moves to the sibling instead of hanging', async () => {
      await waitForStatus(page, 'paused', 30_000)
      const landed = await pausedNodeId(page)
      expect(
        landed.startsWith('vs-b2-'),
        `The released section must surface the sibling branch, got "${landed}"`,
      ).toBeTruthy()
    })

    await test.step('D10: continuing to the end matches a plain run of the same graph', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed', 30_000)
      await waitForLogText(page, 'EXIT')
      const logs = await getLogTexts(page)
      expect(
        logs.filter((t) => t === 'EXIT').length,
        `The exit lane runs once. Got: ${logs.join(' | ')}`,
      ).toBe(1)
      expect(
        logs.filter((t) => t === 'B1').length,
        `Branch 1 logs once. Got: ${logs.join(' | ')}`,
      ).toBe(1)
      expect(await readCounter(page), 'a stepped run ends where a plain run ends').toBe(4)
    })
  })

  test('D6: Step Into advances the paused branch and leaves the sibling parked', async ({
    page,
  }) => {
    await pauseInsideBranchOne(page)
    await page.waitForTimeout(PARK_SETTLE_MS)
    const beforeStep = await readCounter(page)

    await clickStepInto(page)
    await expectPausedAt(page, 'log-b1')

    await page.waitForTimeout(PARK_SETTLE_MS)
    expect(await readCounter(page), 'Step Into is not Continue either').toBe(beforeStep)

    await clickContinue(page)
    await waitForStatus(page, 'passed', 30_000)
    expect(await readCounter(page)).toBe(4)
  })

  test('D7: Skip Block skips the block, re-pauses in the branch, and holds the sibling', async ({
    page,
  }) => {
    await pauseInsideBranchOne(page)
    await page.waitForTimeout(PARK_SETTLE_MS)
    const beforeSkip = await readCounter(page)

    await clickSkipBlock(page)
    await expectPausedAt(page, 'log-b1')

    await test.step('The skipped block reports itself skipped', async () => {
      expect(await getNodeExecStatus(page, 'delay-b1')).toBe('skipped')
    })

    await test.step('The sibling is still parked', async () => {
      await page.waitForTimeout(PARK_SETTLE_MS)
      expect(await readCounter(page)).toBe(beforeSkip)
    })

    await test.step('The rest of the run is unaffected', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed', 30_000)
      await waitForLogText(page, 'EXIT')
      const logs = await getLogTexts(page)
      expect(logs.filter((t) => t === 'EXIT').length).toBe(1)
      expect(await readCounter(page)).toBe(4)
    })
  })

  test('D8: two breakpoints in different branches surface one after another', async ({ page }) => {
    await importAndNavigate(page, loadFixture())
    await toggleBreakpoint(page, 'delay-b1')
    await toggleBreakpoint(page, 'vs-b2-3')
    await setDebugOption(page, 'first', false)
    await selectEnvironment(page)
    await startDebugRun(page)

    await test.step('The first cursor is in branch 1, and it is the only paused block', async () => {
      await expectPausedAt(page, 'delay-b1')
      await expect(page.locator('[data-testid^="workflow-node-"][data-paused="true"]')).toHaveCount(
        1,
      )
    })

    await test.step('The held sibling becomes the paused block once the section is released', async () => {
      await clickContinue(page)
      await expectPausedAt(page, 'vs-b2-3', 30_000)
      await expect(page.locator('[data-testid^="workflow-node-"][data-paused="true"]')).toHaveCount(
        1,
      )
    })

    await test.step('The run finishes normally after the second Continue', async () => {
      await clickContinue(page)
      await waitForStatus(page, 'passed', 30_000)
      await waitForLogText(page, 'EXIT')
      expect(await readCounter(page)).toBe(4)
    })
  })
})
