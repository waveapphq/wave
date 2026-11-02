/**
 * V-NESTING-SIGNALS-FAILURE-RELOAD-FUNCTIONAL: Blocks in a nested branch paint the same during the run and after a reload
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.2.2.9, REQ-4.3.2
 *
 * Cells R.for-body.if-branch.fails-in-branch, R.for-body.assert-fail.fails-in-branch, R.try.if-branch.fails-in-branch
 * and R.for-body.if-branch.fails-after-rejoin. An If/Else if branch or a split Assert fail branch sits in a For Loop
 * body or a Try/Catch try path; a marker runs in the branch and a Block fails either inside the branch or after the
 * branch rejoins. The routed branch edge is stored before its sibling. The run starts on the canvas.
 *
 * Pass Criteria:
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is failed in a For Loop body and passed in a try path (the Try/Catch catches the failure)
 * 3. During the run the marker paints success, the failing Block paints failed and the marker the failure cut off
 *    paints skipped
 * 4. The session API stores passed for the marker, failed for the failing Block and skipped for the cut-off marker
 * 5. After a page reload the canvas paints the same three statuses
 */

import { test } from '../../helpers/playwright-fixtures'
import { CELL_TIMEOUT_MS, reloadDescribeTitle, reloadPlans, runReloadCell } from './reload-cells'
import { deleteSignalCellEntities } from './signal-cell-open'

test.describe(reloadDescribeTitle, () => {
  test.afterEach(async ({ request }, testInfo) => deleteSignalCellEntities(request, testInfo))
  for (const plan of reloadPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runReloadCell(page, plan)
    })
  }
})
