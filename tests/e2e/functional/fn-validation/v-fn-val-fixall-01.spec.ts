/**
 * V-FN-VAL-FIXALL-01: "Fix All" appears only when >=1 issue is auto-fixable.
 * REQ: REQ-3.1.2.4.
 *
 * Validation routes content issues (missing param, missing version - all fix_action=null)
 * into the same load dialog as auto-fixable issues, so the button is gated on the auto-fixable
 * subset. Invariant guarded: Fix All shown <=> >=1 row has a real Fix.
 *
 * Both broken states are raw-persisted (POST /tests rejects them with 422).
 *
 * Pass Criteria:
 *   A. Content-only (missing param + missing version): headline reads
 *      "2 item(s) must be resolved manually", NO Fix All, every Fix cell "-".
 *   B. Mixed (+ a fixable dangling edge): Fix All IS present, headline reads
 *      "1 of 3 item(s) can be automatically fixed", the fixable row shows its
 *      action and the two content rows show "-".
 *
 * (Fix All execution is covered by tests/e2e/visual/canvas/v-validate-load-01.)
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  rawPersistTest,
  logNode,
  localFunctionNode,
  sharedNode,
  startEdge,
  openTest,
  VALIDATION,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'

/** Fn_A (Log with empty required message) + a top-level Shared pinned to the
 *  absent 2.0.0. `extraEdges` lets a scenario add a fixable dangling edge. */
function brokenNodes(fn: SeededLibraryFunction) {
  return [
    localFunctionNode('fn-a', 'Fn_A', {
      nodes: [logNode('log-1', 'Log_1', '')],
      edges: [startEdge('log-1')],
    }),
    sharedNode('shared-1', {
      functionId: fn.functionId,
      functionVersion: '2.0.0',
      label: 'Greet',
      originalLibraryName: fn.name,
      position: { x: 520, y: 200 },
    }),
  ]
}

const BASE_EDGES = [startEdge('fn-a'), { id: 'e-fn-sh', source: 'fn-a', target: 'shared-1' }]

test.describe('V-FN-VAL-FIXALL-01: Fix All gated on the auto-fixable subset', () => {
  test('content-only issues: no Fix All, "must be resolved manually" headline', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, { name: `FixAllA ${Date.now()}` })
    const testId = await rawPersistTest(request, {
      name: 'V-FN-VAL-FIXALL-01 content-only',
      nodes: brokenNodes(fn),
      edges: BASE_EDGES,
    })
    await openTest(page, testId)

    const dialog = page.locator(VALIDATION.dialog)
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('Test Issues Found')
    await expect(dialog.locator(VALIDATION.count)).toHaveText('2')
    await expect(dialog).toContainText('must be resolved manually')

    // No Fix All when nothing is auto-fixable.
    await expect(dialog.locator(VALIDATION.fixAllBtn)).toHaveCount(0)

    // Every Fix cell renders "-".
    const fixCells = dialog.locator('tbody tr td:nth-child(2)')
    await expect(fixCells).toHaveCount(2)
    for (const text of await fixCells.allInnerTexts()) {
      expect(text.trim()).toBe('-')
    }
  })

  test('a fixable dangling edge enables Fix All with a partial-count headline', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, { name: `FixAllB ${Date.now()}` })
    const testId = await rawPersistTest(request, {
      name: 'V-FN-VAL-FIXALL-01 mixed',
      nodes: brokenNodes(fn),
      // The dangling edge targets a non-existent node -> auto-fixable structural issue.
      edges: [...BASE_EDGES, { id: 'e-dangle', source: 'shared-1', target: 'ghost-xyz' }],
    })
    await openTest(page, testId)

    const dialog = page.locator(VALIDATION.dialog)
    await expect(dialog).toBeVisible({ timeout: 15_000 })
    await expect(dialog).toContainText('Test Issues Found')

    // Fix All IS offered; the headline counts only the fixable subset.
    await expect(dialog.locator(VALIDATION.fixAllBtn)).toBeVisible()
    await expect(dialog.locator(VALIDATION.count)).toHaveText('1')
    await expect(dialog).toContainText('of 3 item(s) can be automatically fixed')

    // The fixable row shows its action; the two content rows show "-".
    await expect(dialog.getByText('Remove dangling edge')).toBeVisible()
    const fixCells = dialog.locator('tbody tr td:nth-child(2)')
    await expect(fixCells).toHaveCount(3)
    const texts = (await fixCells.allInnerTexts()).map((t) => t.trim())
    expect(texts.filter((t) => t === '-')).toHaveLength(2)
    expect(texts.filter((t) => t === 'Remove dangling edge')).toHaveLength(1)
  })
})
