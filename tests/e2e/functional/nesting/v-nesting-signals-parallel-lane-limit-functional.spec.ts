/**
 * V-NESTING-SIGNALS-PARALLEL-LANE-LIMIT-FUNCTIONAL: a Parallel lane time limit inside loops and Try/Catch paths
 * Wireframe: N/A (no visual surface)
 * Design Decisions: PARALLEL-5
 * REQ: REQ-3.2.3.7, REQ-3.2.3.8, REQ-3.2.2.6, REQ-3.2.2.10
 *
 * One test per cell B5.<slot>.lane-time-limit, slot one of for-body, for-each-body, while-body, try, catch, finally.
 * The Parallel's first lane holds a marker, a 5 s Delay and a marker under a 1 s time limit on that lane only (no
 * section limit); the Parallel and its then successor sit in the slot.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The lane starts once and never passes the expired lane limit; the Parallel's then successor never runs; the
 *    Parallel paints failed
 * 3. Loop body: the loop ends, its then successor and the bookend never run, the verdict is failed
 * 4. Try path: the catch runs once, the Try/Catch then successor and the bookend run, the verdict is passed
 * 5. Catch path: the finally path still runs, nothing after runs, the verdict is failed
 * 6. Finally path: the try path ran first, nothing after runs, the verdict is failed
 * 7. No node is left running
 */

import { test } from '../../helpers/playwright-fixtures'
import { deleteCellEntities } from './nesting-harness'
import {
  CELL_TIMEOUT_MS,
  LANE_TIME_LIMIT_DESCRIBE,
  laneTimeLimitPlans,
  runParallelSignalCell,
} from './parallel-signal-cells'

test.describe(LANE_TIME_LIMIT_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of laneTimeLimitPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runParallelSignalCell(page, plan)
    })
  }
})
