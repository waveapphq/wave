/**
 * V-NESTING-SIGNALS-BREAK-CONTINUE-BRANCHES-FUNCTIONAL: Break and Continue in the If/Else else branch, the Switch/Case
 * default and the split Assert fail leg inside each loop kind
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.5.1.2, REQ-3.5.1.3, REQ-3.5.0.9, REQ-3.1.1.4
 *
 * One test per cell B1.<for|for-each|while>.<else-branch|default|assert-fail>.<break|continue>.<nearest|outer>; every
 * loop runs 2 iterations. The run is routed into the else branch by an if condition that does not hold, into the
 * default by one case that does not match, and into the fail leg by an expression that is False with Fail current
 * scope off. The nearest variant targets the loop holding the container; the outer variant nests that loop in a
 * second loop of the same kind and targets the outer one.
 *
 * Pass Criteria (If/Else else branch, split Assert fail leg):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is passed
 * 3. Break: the target loop body runs once; Continue: it runs on every iteration
 * 4. The slot's steps after the signal and the loop body's steps after the container never run
 * 5. The target loop's then successor runs once; an intermediate loop's then successor never runs
 * 6. No node is left running and no console ERROR line appears
 * 7. The untaken branch of the If/Else or split Assert in the loop body never runs and paints skipped
 *
 * Switch/Case default: the design does not settle the outcome, so the cell records a refusal or the run and asserts
 * only that a run it starts ends with no node left running.
 */

import { test } from '../../helpers/playwright-fixtures'
import {
  BRANCH_SIGNAL_SLOTS,
  CELL_TIMEOUT_MS,
  breakContinueCellPlans,
  breakContinueDescribeTitle,
  runBreakContinueCell,
  type LoopKind,
} from './break-continue-cells'
import { deleteCellEntities } from './nesting-harness'
import { deleteSignalCellEntities } from './signal-cell-open'

const LOOPS: readonly LoopKind[] = ['for', 'for-each', 'while']

for (const loop of LOOPS) {
  test.describe(breakContinueDescribeTitle(loop), () => {
    test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
    test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))
    for (const plan of breakContinueCellPlans(loop, BRANCH_SIGNAL_SLOTS)) {
      test(plan.title, async ({ page }) => {
        test.setTimeout(CELL_TIMEOUT_MS)
        await runBreakContinueCell(page, plan)
      })
    }
  })
}
