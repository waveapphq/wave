/**
 * V-NESTING-DEBUG-FUNCTIONAL: a breakpoint on a Block at depth 2 in every slot kind
 * Wireframe: N/A (no visual surface)
 * Design Decisions: CANVAS-81
 * REQ: REQ-3.2.2.3, REQ-3.2.1.3, REQ-3.2.1.4, REQ-3.2.1.1
 *
 * One test per cell C.debug.<slot>. The Test runs pre -> a Try/Catch whose try path holds the inner
 * container (inner -> inner-then) -> outer-then -> bookend; the inner container's <slot> holds the
 * marker Logs bp -> next. Loops run once and a Wait Until keeps a long time limit, so one pause is
 * enough and no limit expires while paused. Inside a Function body the breakpoint is set while
 * paused on the Function instance, because a library Function body offers no node menu before a run.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. Debug pauses on bp before bp runs, and the paused border paints on bp
 * 3. Repeat Step runs bp and re-pauses on it with a passed badge; a second Repeat Step runs it again;
 *    next and inner-then have not run
 * 4. Step Over pauses on next before next runs, and bp does not run again (EM:1370, EM:1380)
 * 5. Step Over from next runs next once; where the design settles it, the pause lands on the
 *    sibling-after (the rejoin of an If/Else or split Assert leg, the While / Wait Until counter
 *    tail, the node after a Function instance)
 * 6. Continue runs to passed: bp ran exactly twice (once per Repeat Step), pre, next, inner-then,
 *    outer-then and the bookend ran once each, untaken markers never ran, sibling markers ran once,
 *    no node is left running, no console ERROR line (a named trigger excepted)
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { SLOT_KINDS, marker, type SlotKind } from '../../helpers/nesting-graph'
import { digIn } from '../../helpers/workbench'
import { clickContinue, clickRepeatStep, clickStepOver, toggleBreakpoint } from '../debug-step/helpers'
import {
  continueToTerminal,
  expectLiveMarkerCount,
  expectPausedOn,
  stepOverAndRecordLanding,
} from './debug-adhoc-drive'
import {
  deleteCellEntities,
  expectMarkerCount,
  expectNoErrorLines,
  expectNoNodeRunning,
  expectRanBefore,
  expectVerdict,
  finishCell,
  openCell,
  startCellDebug,
  type NestCell,
} from './nesting-harness'
import {
  INNER,
  INNER_THEN,
  OUTER,
  OUTER_THEN,
  PAUSE_SAFE_WAIT_TIMEOUT_MS,
  PRE,
  SLOT_TITLE,
  slotDepthChain,
} from './slot-depth-graph'

const CELL_TIMEOUT_MS = 300_000
const BP = 'bp'
const NEXT = 'next'

/** Slots whose last Block's sibling-after is a direct successor (EM:1368) or the Function's sibling-after (FX:49). */
const THEN_LANDING_SLOTS: readonly SlotKind[] = ['if-branch', 'else-branch', 'assert-pass', 'assert-fail', 'function-body']
/** Slots whose body the builder closes with a counter Variable Setter after next. */
const COUNTER_LANDING_SLOTS: readonly SlotKind[] = ['while-body', 'wait-until-body']

async function armBreakpoint(page: Page, cell: NestCell, slot: SlotKind): Promise<void> {
  if (slot !== 'function-body') {
    await toggleBreakpoint(page, BP)
    await startCellDebug(page, cell)
    return
  }
  await toggleBreakpoint(page, INNER)
  await startCellDebug(page, cell)
  await expectPausedOn(page, cell, INNER, 'the breakpoint on the Function instance pauses')
  await digIn(page, INNER)
  await expect(page.locator(`[data-testid="workflow-node-${BP}"]`), `${cell.cellId}: bp shows inside the Function body`).toBeVisible({
    timeout: 15_000,
  })
  await toggleBreakpoint(page, BP)
  await clickContinue(page)
}

async function runDebugCell(page: Page, slot: SlotKind): Promise<void> {
  const cellId = `C.debug.${slot}`
  const cell = await openCell(page, cellId, {
    chain: slotDepthChain(slot, [marker(BP), marker(NEXT)], {
      iterations: 1,
      timeoutMs: PAUSE_SAFE_WAIT_TIMEOUT_MS,
    }),
  })
  await armBreakpoint(page, cell, slot)

  await expectPausedOn(page, cell, BP, 'the breakpoint pauses on the depth-2 Block')
  await expectLiveMarkerCount(page, cell, BP, 0, 'the pause lands before the Block runs')
  await expectLiveMarkerCount(page, cell, NEXT, 0, 'the next Block has not run at the pause')

  await clickRepeatStep(page)
  await expectLiveMarkerCount(page, cell, BP, 1, 'Repeat Step runs the paused Block')
  await expectPausedOn(page, cell, BP, 'Repeat Step re-pauses on the same Block')
  await expect
    .soft(page.locator(`[data-testid="workflow-node-${BP}"]`), `${cellId}: the badge shows the re-run's passed result`)
    .toHaveAttribute('data-execution-status', 'success', { timeout: 10_000 })
  await clickRepeatStep(page)
  await expectLiveMarkerCount(page, cell, BP, 2, 'a second Repeat Step reruns the Block')
  await expectPausedOn(page, cell, BP, 'the second Repeat Step re-pauses on the same Block')
  await expectLiveMarkerCount(page, cell, NEXT, 0, 'Repeat Step reruns only the paused Block')
  await expectLiveMarkerCount(page, cell, INNER_THEN, 0, 'Repeat Step reruns only the paused Block')

  await clickStepOver(page)
  await expectPausedOn(page, cell, NEXT, 'Step Over pauses on the next Block in the slot')
  await expectLiveMarkerCount(page, cell, NEXT, 0, 'the pause lands before the next Block runs')
  await expectLiveMarkerCount(page, cell, BP, 2, 'Step Over after Repeat Step does not run the Block again')

  if (THEN_LANDING_SLOTS.includes(slot)) {
    await clickStepOver(page)
    await expectPausedOn(page, cell, INNER_THEN, 'Step Over from the last Block pauses on the sibling-after')
    await expectLiveMarkerCount(page, cell, INNER_THEN, 0, 'the pause lands before the sibling-after runs')
  } else if (COUNTER_LANDING_SLOTS.includes(slot)) {
    const counter = cell.graph.containers[INNER].counter ?? `${INNER}-count`
    await clickStepOver(page)
    await expectPausedOn(page, cell, counter, 'Step Over from next pauses on the counter tail after it')
  } else {
    await stepOverAndRecordLanding(page, cell, NEXT)
  }
  await expectLiveMarkerCount(page, cell, NEXT, 1, 'Step Over runs the paused Block to completion')

  await continueToTerminal(page, cell)
  const run = await finishCell(page, cell)
  const inner = cell.graph.containers[INNER]
  const outer = cell.graph.containers[OUTER]

  expectVerdict(cell, run, 'passed')
  expectMarkerCount(cell, run, BP, 2, 'the repeated Block runs once per Repeat Step and never again')
  expectMarkerCount(cell, run, PRE, 1, 'the Block before the containers runs once')
  expectMarkerCount(cell, run, NEXT, 1, 'the next Block runs once')
  expectMarkerCount(cell, run, INNER_THEN, 1, 'the inner then successor runs once')
  expectMarkerCount(cell, run, OUTER_THEN, 1, 'the outer then successor runs once')
  expectMarkerCount(cell, run, cell.graph.bookendId, 1, 'Continue finishes the run through the bookend')
  for (const id of [...inner.untaken, ...outer.untaken]) {
    expectMarkerCount(cell, run, id, 0, 'an untaken branch never runs')
  }
  for (const id of [...inner.siblings, ...outer.siblings]) {
    expectMarkerCount(cell, run, id, 1, 'a sibling path runs once')
  }
  expectRanBefore(cell, run, NEXT, INNER_THEN, 'the slot runs before the inner then successor')
  expectRanBefore(cell, run, INNER_THEN, OUTER_THEN, 'the inner then successor runs inside the outer slot')
  expectRanBefore(cell, run, OUTER_THEN, cell.graph.bookendId, 'the outer then successor runs before the bookend')
  expectNoNodeRunning(cell, run)
  expectNoErrorLines(cell, run)
}

test.describe('Matrix C: debug a Block at depth 2 in every slot kind', () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const slot of SLOT_KINDS) {
    test(`C.debug.${slot}: a breakpoint on a depth-2 Block in ${SLOT_TITLE[slot]} pauses, repeats, steps and continues`, async ({
      page,
    }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runDebugCell(page, slot)
    })
  }
})
