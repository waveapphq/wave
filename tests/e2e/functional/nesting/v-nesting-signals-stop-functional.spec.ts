/**
 * V-NESTING-SIGNALS-STOP-FUNCTIONAL: an Immediate Stop while a Block at depth 3 runs, in each container kind
 * Wireframe: N/A (no visual surface)
 * Design Decisions: CANVAS-70, SHRUN-15, REMEX-4
 * REQ: REQ-3.2.2.4, REQ-4.3.2, REQ-3.4.1.3
 *
 * One test per cell B6.<container>. The same container kind sits at three levels; the innermost slot holds a
 * Shell Script that starts a background job, records its pid and holds. In the Remote Execution cell the
 * innermost body first reads a host file and records this connection's own worker pids. A Shell Exec tree
 * probe follows the outermost container.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. Once the Shell Script's ready line is on the console, an Immediate Stop brings the run to stopped within 10 s
 * 3. The Shell Script paints stopped; each in-flight container around it (not If/Else or split Assert) paints
 *    stopped; no node is left running
 * 4. Nothing after the Stop runs: the tree probe variable keeps its seed, the bookend never runs, untaken
 *    branches never run
 * 5. Run Current on the tree probe reads gone within 30 s
 * 6. Remote Execution: at least one worker pid of this run's own connection was recorded, and a checker Test
 *    reads gone for every recorded pid within 30 s
 */

import { test } from '../../helpers/playwright-fixtures'
import { deleteCellEntities } from './nesting-harness'
import { CELL_TIMEOUT_MS, STOP_DESCRIBE, runStopCell, stopPlans } from './stop-cells'
import { deleteStopProbeTests } from './stop-probes'

test.describe(STOP_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  test.afterEach(async ({ request }, testInfo) => deleteStopProbeTests(request, testInfo))
  for (const plan of stopPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runStopCell(page, plan)
    })
  }
})
