/**
 * V-NESTING-SIGNALS-PARALLEL-FUNCTIONAL: a Parallel lane failure and a Parallel time limit inside loops and Try/Catch paths
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.2.3.7, REQ-3.2.3.8, REQ-3.2.2.6, REQ-3.2.2.10
 *
 * One test per cell B5.<slot>.<lane-failure|time-limit>, slot one of for-body, for-each-body, while-body, try,
 * catch, finally. The Parallel's first lane holds a marker, a failing Block (or a 5 s Delay under a 1 s section
 * time limit) and a marker; the Parallel and its then successor sit in the slot.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The lane starts once and never passes the failure or the expired limit; the Parallel's then successor
 *    never runs; the Parallel paints failed (and the failing Block paints failed)
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
  PARALLEL_SIGNAL_DESCRIBE,
  parallelSignalPlans,
  runParallelSignalCell,
} from './parallel-signal-cells'

test.describe(PARALLEL_SIGNAL_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of parallelSignalPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runParallelSignalCell(page, plan)
    })
  }
})
