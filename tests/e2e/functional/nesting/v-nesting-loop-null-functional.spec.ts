/**
 * V-NESTING-LOOP-NULL-FUNCTIONAL: a loop that runs zero times inside every slot kind, in and out of Functions
 * Wireframe: none
 * Design Decisions: none
 * REQ: REQ-3.1.3.25, REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.1.17, REQ-3.1.1.4
 *
 * B7.loop-null.<for-each|for|for-each-empty>.<slot>: the slot of a container of the slot's kind holds a Log that
 * declares `o_idx` = -1, `o_item` = {type: string, value: seed} and the null variable (`lp_list` array, `lp_count`
 * integer), then the loop `lp` (For Each over `lp_list`, For with count `lp_count`, or For Each over `[]`) with its
 * Index bound to `o_idx` and its Item to `o_item`, then `lp-read` printing both. Inside a Function body the three are
 * Function variables and the call binds `o_idx` and `o_item` back to the Test.
 * B7.zero-run.<kind>.<placement>.<then|no-then>: the same shape for every container whose lane can run zero times
 * (the three cases above, a For with count 0, a For Each over `{}`, a While false at its first check, a Wait Until
 * met at its first check) on the Test flow, in a For body, in a Function body, in a Function inside a Function, and
 * in a For body or a try path inside a Function; with `lp-read` on the then lane, or with the loop last on its lane.
 *
 * Seeds (API): each cell publishes its Functions and imports its own Test through the nesting harness
 * (`functional/nesting/nesting-harness.ts`); the cell deletes both after the test. The top-level placement is built
 * through the UI in V-CTRL-FOREACH-NULL and V-CTRL-FOR-NULL.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is passed, the step after the container and the bookend run once, no ERROR line, nothing running
 * 3. The loop body never runs and the loop reports `Starting loop (0 iterations)` on every entry of the slot
 * 4. The loop's then path runs on every entry of the slot and reads index 0 and the item seed, never `{}`
 * 5. After the run `o_idx` reads 0 and `o_item` still holds its seed (While and Wait Until bind neither)
 * 6. zero-run cells: criteria 1-5 hold wherever the loop sits; a loop last on its lane still never runs its lane
 */

import { test } from '../../helpers/playwright-fixtures'
import { deleteCellEntities } from './nesting-harness'
import {
  CELL_TIMEOUT_MS,
  LOOP_NULL_DESCRIBE,
  ZERO_RUN_DESCRIBE,
  loopNullCellPlans,
  runLoopNullPlan,
  runZeroRunPlan,
  zeroRunCellPlans,
} from './variable-cells'

test.describe(LOOP_NULL_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of loopNullCellPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runLoopNullPlan(page, plan)
    })
  }
})

test.describe(ZERO_RUN_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of zeroRunCellPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runZeroRunPlan(page, plan)
    })
  }
})
