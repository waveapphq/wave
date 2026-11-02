/**
 * V-NESTING-IN-WHILE-FUNCTIONAL: every container kind inside a While body
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.1.1.4, REQ-3.5.1.17
 *
 * One test per cell A.<slot>.<inner>; the inner container's own sub-flow holds a marker Log and a
 * Variable Setter. The outer While-Do runs while its counter is below 2; a counter Variable Setter at the tail of its body ends it.
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

test.describe(placementDescribeTitle('while'), () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of placementCellPlans('while')) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runPlacementCell(page, plan)
    })
  }
})
