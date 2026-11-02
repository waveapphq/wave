/**
 * V-NESTING-SIGNALS-VARIABLES-FUNCTIONAL: variables written, read and isolated at depth
 * Wireframe: N/A (no visual surface)
 * Design Decisions: N/A
 * REQ: REQ-3.1.3.3, REQ-3.1.2.1, REQ-3.2.1.1, REQ-3.5.1.15, REQ-3.5.1.16, REQ-3.5.1.17
 *
 * B7.set-d3.<slot>: three containers of the slot's kind, each routed into that slot, hold a Variable Setter.
 * B7.loop-vars.<loop>.<inner>: a loop binds its index (and a For Each its item); two nested containers of the
 * inner kind hold Logs that print them. A While or Wait Until counter is reset on entry.
 * B7.fn-<input|output|local>.<containers|functions>: a Function at depth 2, inside a Switch/Case case and a try path
 * or inside two Functions.
 *
 * Pass Criteria (every cell):
 * 1. The graph imports with zero validation errors and run-context validation reports none
 * 2. The run verdict is passed, the step after the nest and the bookend run once
 * 3. No node is left running and no console ERROR line appears (a named trigger excepted)
 * 4. set-d3: nest_d3 reads d3-<token> at the top
 * 5. loop-vars: each iteration's index (and item) prints once per inner run; no print shows the unbound seed
 * 6. fn-input: the caller value prints inside the Function; fn-output: iso_out reads out-<token> at the top;
 *    fn-local: the local write ran and iso_local keeps outer-<token>
 */

import { test } from '../../helpers/playwright-fixtures'
import { deleteCellEntities } from './nesting-harness'
import { CELL_TIMEOUT_MS, VARIABLE_DESCRIBE, runVariableCell, variableCellPlans } from './variable-cells'

test.describe(VARIABLE_DESCRIBE, () => {
  test.afterEach(async ({ request }, testInfo) => deleteCellEntities(request, testInfo))
  for (const plan of variableCellPlans()) {
    test(plan.title, async ({ page }) => {
      test.setTimeout(CELL_TIMEOUT_MS)
      await runVariableCell(page, plan)
    })
  }
})
