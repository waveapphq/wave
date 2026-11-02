/**
 * V-NESTING-SIGNALS-HALT-PARALLEL-FUNCTIONAL: a Halt at depth 2 and 3 inside a Parallel, for each scope and status
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.5.1.4, REQ-3.5.1.14, REQ-3.1.1.4
 *
 * One test per cell B2.parallel.d<2|3>.<scope>.<status>. Every level is a Parallel holding its head marker, the next level
 * and an after marker; the last level holds its head marker and the Halt. For a function-scope Halt a top Function wraps the Parallel levels.
 * The second lane of each Parallel runs concurrently with the Halt, so its marker is not asserted.
 *
 * Pass Criteria (test, suite and regression scope):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is the Halt status
 * 3. Every head marker runs once: no further iteration or round runs
 * 4. No after marker, top then successor or bookend runs; no untaken slot runs, a catch path included
 * 5. No node is left running; a passed or skipped Halt writes no console ERROR line
 *
 * Pass Criteria (function scope):
 * 1. passed / skipped: the run passes, nothing after the Halt runs inside the halted Function, and everything after
 *    that Function instance runs once, the bookend included
 * 2. failed: the run fails and nothing after the Halt runs anywhere
 * 3. No node is left running; a passed or skipped Halt writes no console ERROR line
 */

import { test } from '../../helpers/playwright-fixtures'
import { CELL_TIMEOUT_MS, haltCellPlans, haltDescribeTitle, runHaltCell } from './halt-cells'
import { deleteCellEntities } from './nesting-harness'
import { deleteSignalCellEntities } from './signal-cell-open'

test.describe(haltDescribeTitle('parallel'), () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))
  for (const plan of haltCellPlans('parallel')) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runHaltCell(page, plan)
    })
  }
})
