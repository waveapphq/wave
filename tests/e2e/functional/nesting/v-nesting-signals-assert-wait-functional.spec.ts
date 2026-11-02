/**
 * V-NESTING-SIGNALS-ASSERT-WAIT-FUNCTIONAL: a failing single-mode Assert and a Wait Until timeout, each with Fail
 * current scope on, inside each container kind
 * Wireframe: N/A (no visual surface)
 * Design Decisions: WAIT-4
 * REQ: REQ-3.3.1.5, REQ-3.5.1.13, REQ-3.5.4.3
 *
 * One test per cell B4.<container>.<assert-test|assert-function|assert-try|wait-timeout>. The container's slot
 * holds a marker, the signal (a single-mode Assert with Fail current scope on, or a Wait Until whose condition
 * never holds with Fail current scope on) and a marker. The scope boundary around the container is the root
 * Test, a Function body or a top-level Try/Catch try path; the Wait Until cells use the root Test. Either signal is
 * a block failure, so the flow stops at it exactly as it stops at any failed block.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The flow stops at the signal: the marker after it never runs, untaken branches never run
 * 3. The signal paints failed; a Parallel or a Function holding it paints failed
 * 4. No node is left running
 * Cells whose container is not a Wait Until:
 * 5. The marker before the signal runs once and sibling slots run once (a Parallel lane-2 marker only beside
 *    the timed-out Wait Until)
 * 6. A Try/Catch container catches the failure in its own catch path, its then successor and the bookend run
 *    once, and the verdict is passed
 * 7. Otherwise the container's then successor never runs. Root Test: the bookend never runs and the verdict is
 *    failed. Function body: the enclosing Function paints failed, nothing after it runs and the verdict is failed.
 *    Try path: the top-level catch runs after the failure, then the bookend, and the verdict is passed
 *
 * A block failure inside a Wait Until retry sub-flow fails the Wait Until at once, like any container around a failure.
 */

import { test } from '../../helpers/playwright-fixtures'
import { CELL_TIMEOUT_MS, SCOPE_SIGNAL_DESCRIBE, runScopeSignalCell, scopeSignalPlans } from './assert-wait-cells'
import { deleteCellEntities } from './nesting-harness'

test.describe(SCOPE_SIGNAL_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of scopeSignalPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runScopeSignalCell(page, plan)
    })
  }
})
