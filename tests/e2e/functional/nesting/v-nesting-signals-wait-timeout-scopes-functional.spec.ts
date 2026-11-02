/**
 * V-NESTING-SIGNALS-WAIT-TIMEOUT-SCOPES-FUNCTIONAL: a Wait Until timeout inside each container kind inside a Function
 * body or a top-level try path
 * Wireframe: N/A (no visual surface)
 * Design Decisions: WAIT-4
 * REQ: REQ-3.5.4.3, REQ-3.2.1.1, REQ-3.2.2.6
 *
 * One test per cell B4.<container>.wait-timeout-<function|try>. The container's slot holds a marker, a Wait Until
 * whose condition never holds with Fail current scope on and a 1.5 s timeout, and a marker. The scope boundary
 * around the container is a Function body or a top-level Try/Catch try path. The timeout is a block failure, so
 * the flow stops at the Wait Until exactly as it stops at any failed block.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The flow stops at the timeout: the marker after it never runs, untaken branches never run
 * 3. The Wait Until paints failed where it is on the Test canvas; a Parallel or a Function holding it paints failed
 * 4. No node is left running
 * Cells whose container is not a Wait Until:
 * 5. The marker before the Wait Until runs once and sibling slots run once
 * 6. A Try/Catch container catches the failure in its own catch path, its then successor and the bookend run
 *    once, and the verdict is passed (the node after the enclosing Function runs once; the top-level catch never runs)
 * 7. Otherwise the container's then successor never runs. Function body: the enclosing Function paints failed,
 *    nothing after it runs and the verdict is failed. Try path: the top-level catch runs after the failure, then
 *    the bookend, and the verdict is passed
 *
 * A block failure inside a Wait Until retry sub-flow fails the Wait Until at once, like any container around a failure.
 */

import { test } from '../../helpers/playwright-fixtures'
import {
  CELL_TIMEOUT_MS,
  WAIT_TIMEOUT_SCOPE_DESCRIBE,
  runScopeSignalCell,
  waitTimeoutScopePlans,
} from './assert-wait-cells'
import { deleteCellEntities } from './nesting-harness'

test.describe(WAIT_TIMEOUT_SCOPE_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of waitTimeoutScopePlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runScopeSignalCell(page, plan)
    })
  }
})
