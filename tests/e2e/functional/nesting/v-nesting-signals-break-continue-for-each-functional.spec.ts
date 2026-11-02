/**
 * V-NESTING-SIGNALS-BREAK-CONTINUE-FOR-EACH-FUNCTIONAL: Break and Continue across non-loop containers inside a For Each
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.5.1.2, REQ-3.5.1.3, REQ-3.1.1.4
 *
 * One test per cell B1.for-each.<slot>.<break|continue>.<nearest|outer>; every loop runs 2 iterations. The nearest
 * variant targets the For Each holding the container; the outer variant nests that loop in a second For Each and targets
 * the outer one.
 *
 * Pass Criteria (If/Else if branch, split Assert pass leg, Parallel lane, try, catch, finally):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is passed
 * 3. Break: the target loop body runs once; Continue: it runs on every iteration
 * 4. The slot's steps after the signal and the loop body's steps after the container never run
 * 5. The target loop's then successor runs once; an intermediate loop's then successor never runs
 * 6. No node is left running and no console ERROR line except the catch trigger's
 * 7. The untaken branch of an If/Else or split Assert in the loop body paints skipped
 * 8. try, catch, finally (finally path enabled): the catch path never runs for a signal in try; the finally path, or
 *    the try path for a signal in finally, runs once each time the signal leaves the Try/Catch, before the target
 *    loop's then successor
 *
 * Other slots (Switch/Case case, Wait Until retry body, Remote Execution body, Function body):
 * the design does not settle the outcome, so the cell records a refusal or the run and asserts only that a run it
 * starts ends with no node left running.
 */

import { test } from '../../helpers/playwright-fixtures'
import {
  CELL_TIMEOUT_MS,
  breakContinueCellPlans,
  breakContinueDescribeTitle,
  runBreakContinueCell,
} from './break-continue-cells'
import { deleteCellEntities } from './nesting-harness'
import { deleteSignalCellEntities } from './signal-cell-open'

test.describe(breakContinueDescribeTitle('for-each'), () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))
  for (const plan of breakContinueCellPlans('for-each')) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runBreakContinueCell(page, plan)
    })
  }
})
