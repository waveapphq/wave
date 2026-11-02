/**
 * V-NESTING-SIGNALS-FAILURE-WHILE-FUNCTIONAL: a failing Block at depth 2 inside every container kind inside a While
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.2.1.1, REQ-3.2.2.6, REQ-3.2.2.9
 *
 * One test per cell B3.while.<inner>.<trycatch|bare>.<then|nothen>. The inner container's slot holds a
 * marker, a failing Block and a marker; the inner container sits in the outer container's slot. A
 * Try/Catch fails through its catch path. `trycatch` wraps the chain in a top-level Try/Catch;
 * `nothen` leaves every container without a then successor (the bookend is dropped).
 *
 * Pass Criteria (cells with no Wait Until):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The failing slot runs once, the Block after the failing Block never runs, untaken branches never run
 * 3. No then successor runs after the failure
 * 4. bare: the run verdict is failed and the bookend never runs
 * 5. trycatch: the top-level catch runs once after the failure, the verdict is passed, the bookend runs once
 * 6. The failing Block paints failed; a Parallel or a Function around it paints failed
 * 7. No node is left running
 * Cells with a Wait Until check criterion 1, that untaken branches never run and that no node is left running.
 */

import { test } from '../../helpers/playwright-fixtures'
import { CELL_TIMEOUT_MS, failureDescribeTitle, failurePlans, runFailureCell } from './failure-cells'
import { deleteCellEntities } from './nesting-harness'
import { deleteSignalCellEntities } from './signal-cell-open'

test.describe(failureDescribeTitle('while'), () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))
  for (const plan of failurePlans('while')) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runFailureCell(page, plan)
    })
  }
})
