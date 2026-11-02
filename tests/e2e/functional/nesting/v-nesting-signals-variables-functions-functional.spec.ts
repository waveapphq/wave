/**
 * V-NESTING-SIGNALS-VARIABLES-FUNCTIONS-FUNCTIONAL: a Function input passed by value, and one Function called twice at once
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.1.2.1, REQ-3.2.1.1, REQ-3.2.3.1, REQ-3.2.3.3
 *
 * B7.fn-by-value.lanes: lane 1 of a Parallel calls a Function whose input is bound to a Test variable; the body
 * prints the input, holds 4 s and prints it again. Lane 2 waits 1.5 s, writes that Test variable and prints it.
 * B7.fn-concurrent.lanes: one library Function is called from both lanes of a Parallel with different inputs and
 * different output bindings. Its body copies the input into a local, prints both, holds 4 s, prints both again and
 * writes an output from the local.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is passed, the step after the Parallel and the bookend run once
 * 3. No node is left running and no console ERROR line appears
 * 4. by-value: the Function reads the caller value at the start; the caller write lands after that and before the
 *    second read; the second read still shows the value copied at the call; the Test variable holds the new value
 * 5. concurrent: both calls start before either reads again; each call reads its own input and local at the start
 *    and after the hold, never a mix; each call's output reaches only its own call-site variable
 */

import { test } from '../../helpers/playwright-fixtures'
import { deleteCellEntities } from './nesting-harness'
import {
  CELL_TIMEOUT_MS,
  LANE_ISOLATION_DESCRIBE,
  laneIsolationCellPlans,
  runLaneIsolationCell,
} from './variable-cells'

test.describe(LANE_ISOLATION_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of laneIsolationCellPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runLaneIsolationCell(page, plan)
    })
  }
})
