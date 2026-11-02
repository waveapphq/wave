/**
 * V-NESTING-IN-WAIT-UNTIL-FUNCTIONAL: every container kind inside a Wait Until retry body
 * Wireframe: N/A (no visual surface)
 * Design Decisions: WAIT-8
 * REQ: REQ-3.1.1.4, REQ-3.5.4.3, REQ-3.5.4.4
 *
 * One test per cell A.<slot>.<inner>; the inner container's own sub-flow holds a marker Log and a
 * Variable Setter. The outer wait checks a counter first; its retry body runs once, and a counter Variable Setter at the body tail makes the next check hold.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is passed
 * 3. The inner sub-flow marker runs the expected number of times; untaken branch markers never run
 * 4. The inner then successor (or rejoin) runs once per entry, before the outer then successor
 * 5. The outer then successor and the bookend run once
 * 6. No node is left running and no console ERROR line appears (a named trigger excepted)
 * 7. nest_inner, written at the innermost depth, reads inner-<token> after the run
 * 8. Inside a loop body, the untaken branch Blocks of a branching inner container paint skipped
 */

import { test } from '../../helpers/playwright-fixtures'
import { deleteCellEntities } from './nesting-harness'
import { CELL_TIMEOUT_MS, placementCellPlans, placementDescribeTitle, runPlacementCell } from './placement-cells'

test.describe(placementDescribeTitle('wait-until'), () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of placementCellPlans('wait-until')) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runPlacementCell(page, plan)
    })
  }
})
