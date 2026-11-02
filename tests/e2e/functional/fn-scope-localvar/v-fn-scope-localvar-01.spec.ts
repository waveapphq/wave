/**
 * V-FN-SCOPE-LOCALVAR-01: a Function body referencing its own declared LOCAL
 * variable saves clean.
 * REQ: REQ-3.1.2.4.
 *
 * The canvas persists a Function's local variables as an ARRAY of {name,...}.
 * The BE `_function_scope_names` and the FE `useFunctionScope`/`varNamesFrom` read that array,
 * so a body that reads its own declared local var saves clean and drills without a crash.
 *
 * Pass Criteria:
 *   1. POST /tests accepts the Test (no UNRESOLVED_VARIABLE_REFERENCE on save).
 *   2. On load there is no validation dialog and the Function node has no alert.
 *   3. Drilling into the body renders the inner node (no crash).
 *   4. validate (run) is clean - no UNRESOLVED_VARIABLE_REFERENCE.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  createValidTest,
  logNode,
  localFunctionNode,
  startEdge,
  openTest,
  validateTest,
  codesOf,
  VALIDATION,
} from '../../helpers/fn-seed'

const FN_NODE_ID = 'fn-1'

test.describe('V-FN-SCOPE-LOCALVAR-01: self-referencing local variable', () => {
  test('a body reading its own declared local variable saves clean', async ({ page, request }) => {
    // The inner Log reads the bare name `subtotal`; the Function declares
    // `subtotal` as a local variable in the canvas ARRAY shape. createValidTest
    // asserts the write path accepts it (guards the BE array-scope collector).
    const testId = await createValidTest(request, {
      name: `V-FN-SCOPE-LOCALVAR-01 ${Date.now()}`,
      nodes: [
        localFunctionNode(FN_NODE_ID, 'Function_1', {
          nodes: [logNode('inner-log', 'InnerLog', 'subtotal')],
          edges: [startEdge('inner-log')],
          variables: [{ name: 'subtotal', type: 'string', value: '10' }],
        }),
      ],
      edges: [startEdge(FN_NODE_ID)],
    })

    await openTest(page, testId)

    // 2. No validation dialog; the Function node carries no alert badge.
    const dialog = page.locator(VALIDATION.dialog)
    await page.waitForTimeout(800)
    await expect(dialog).toHaveCount(0)
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(node).toBeVisible()
    await expect(node.locator('[data-testid="node-validation-alert"]')).toHaveCount(0)

    // 3. Drilling into the body renders the inner node - no crash.
    await node.locator('[data-testid="node-dig-in"]').click()
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible({
      timeout: 10_000,
    })

    // 4. The canonical pipeline reports no unresolved reference for the self-ref.
    const result = await validateTest(request, testId, 'run')
    expect(result.status, 'self-referencing local var validates clean (200)').toBe(200)
    expect(codesOf(result.errors)).not.toContain('UNRESOLVED_VARIABLE_REFERENCE')
  })
})
