/**
 * V-UNDO-DRILL (functional): undo/redo vs drill state.
 *
 * REQ: REQ-5.2.1.24 (Undo/redo support for critical operations).
 *
 * Pass Criteria:
 *   1. Stay-put undo: while drilled into a LOCAL Function, undoing a
 *      body edit keeps the user drilled; breadcrumb and canvas stay coherent
 *      through the whole undo chain down to the baseline.
 *   2. Re-drill then undo: popping out, re-drilling, then undoing
 *      produces no chrome/breadcrumb desync.
 *   3. Undo that invalidates the drilled Shared scope: no crash; the
 *      view auto-pops to the nearest valid ancestor with the undo announcement
 *      as the only cue.
 *   4. Pop-out residue: drill in / pop out never dirties; undo right
 *      after a pop-out leaves a coherent, residue-free canvas.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas } from '../../helpers/canvas'
import {
  publishLibraryFunction,
  createValidTest,
  localFunctionNode,
  sharedNode,
  logNode,
  startEdge,
  openTest,
  type SeededLibraryFunction,
} from '../../helpers/fn-seed'
import {
  undoBtn,
  redoBtn,
  saveBtn,
  clickUndo,
  clickRedo,
  dragNodeBy,
  digIn,
  popToBreadcrumbSegment,
  breadcrumbFunctionSegments,
  readNodeTransform,
  disableNode,
  editModeOverlay,
} from '../../helpers/workbench'
import { clickNodeKebabItem } from '../../helpers/canvas'
import { randomUUID } from 'node:crypto'

/** Test with one local Function whose body holds a single Log. */
function seedLocalFnTest(request: APIRequestContext, name: string): Promise<string> {
  return createValidTest(request, {
    name,
    nodes: [
      localFunctionNode(
        'fn-local',
        'Function_1',
        {
          nodes: [logNode('inner-log', 'Inner', "'inner-line'", { x: 200, y: 180 })],
          edges: [startEdge('inner-log')],
        },
        { x: 320, y: 200 },
      ),
    ],
    edges: [startEdge('fn-local')],
  })
}

/** Library Function + Test hosting a clean Shared ref and a root Log. */
async function seedSharedRefTest(
  request: APIRequestContext,
  name: string,
): Promise<{ testId: string; lib: SeededLibraryFunction }> {
  const lib = await publishLibraryFunction(request, {
    name: `DrillLib-${randomUUID().slice(0, 6)}`,
    workflow: {
      nodes: [
        logNode('lib-keep', 'Keep', "'lib-keep'", { x: 200, y: 160 }),
        logNode('lib-drop', 'Drop', "'lib-drop'", { x: 200, y: 300 }),
      ],
      edges: [startEdge('lib-keep'), { id: 'e-lk-ld', source: 'lib-keep', target: 'lib-drop' }],
    },
  })
  const testId = await createValidTest(request, {
    name,
    nodes: [
      logNode('root-log', 'RootLog', "'root-line'", { x: 200, y: 140 }),
      sharedNode('fn-shared', {
        functionId: lib.functionId,
        functionVersion: lib.version,
        label: lib.name,
        position: { x: 200, y: 300 },
      }),
    ],
    edges: [startEdge('root-log'), { id: 'e-rl-fs', source: 'root-log', target: 'fn-shared' }],
  })
  return { testId, lib }
}

const workflowNodes = (page: import('@playwright/test').Page) =>
  page.locator('[data-testid^="workflow-node-"][data-nodetype]')

test.describe('V-UNDO-DRILL (functional): undo/redo vs drill state', () => {
  test('stay-put undo while drilled into a local Function; re-drill never desyncs', async ({
    page,
    request,
  }) => {
    // Undo/redo while drilled never degrades the canvas to root while
    // breadcrumb/chrome still report drilled. Stay-put keeps location and view coherent.
    const testId = await seedLocalFnTest(request, `V-UNDO-DRILL-STAY ${randomUUID().slice(0, 8)}`)
    await openTest(page, testId)

    // Baseline floor: a freshly loaded Test has nothing to undo.
    await expect(undoBtn(page)).toBeDisabled()

    // Drill into the local Function; drilling itself never commits history.
    await digIn(page, 'fn-local')
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible()
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
    await expect(undoBtn(page)).toBeDisabled()

    // Add a Log INSIDE the body, far from the existing node (no auto-connect,
    // so the drop commits exactly ONE history entry - the edge count proves it).
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    const edgesBefore = await page.locator('.react-flow__edge:not([data-id="ghost-edge"])').count()
    await dragPaletteItemToCanvas(
      page,
      { term: 'log', testId: 'palette-item-log' },
      { x: box!.width * 0.78, y: box!.height * 0.78 },
    )
    await expect(workflowNodes(page)).toHaveCount(2)
    await expect(page.locator('.react-flow__edge:not([data-id="ghost-edge"])')).toHaveCount(
      edgesBefore,
    )
    await expect(undoBtn(page)).toBeEnabled()

    // Undo the body edit: the added block disappears but the user STAYS
    // drilled - breadcrumb still shows the Function segment, the inner body
    // is still the active canvas, the outer node is not rendered.
    await clickUndo(page)
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-local"]')).toHaveCount(0)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
    await expect(undoBtn(page)).toBeDisabled()

    // Redo restores the block, still without leaving the scope.
    await clickRedo(page)
    await expect(workflowNodes(page)).toHaveCount(2)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)

    // Sequence: pop out, re-drill, then undo. Canvas and breadcrumb
    // must agree (drilled view, one Function segment, no outer node).
    await popToBreadcrumbSegment(page, /V-UNDO-DRILL-STAY/)
    await expect(page.locator('[data-testid="workflow-node-fn-local"]')).toBeVisible()
    await digIn(page, 'fn-local')
    await expect(workflowNodes(page)).toHaveCount(2)
    await clickUndo(page)
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(page.locator('[data-testid="workflow-node-inner-log"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-fn-local"]')).toHaveCount(0)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
  })

  test('undo that unmaterializes the drilled Shared body auto-pops to root without crashing', async ({
    page,
    request,
  }) => {
    // Restoring an entry whose Shared node carries no
    // materialized body never crashes the canvas render (walkActiveSubtree).
    // Stay-put degrades + reconciles: auto-pop to the nearest valid ancestor.
    const { testId } = await seedSharedRefTest(
      request,
      `V-UNDO-DRILL-POP ${randomUUID().slice(0, 8)}`,
    )
    await openTest(page, testId)

    // One history entry committed BEFORE drilling (its snapshot has no
    // transient drill stamp on the Shared node).
    const drag = await dragNodeBy(page, 'root-log', { confirmTestId: 'toolbar-save-button' })

    // Drill into the clean Shared: read-only inspect of the published body.
    await digIn(page, 'fn-shared')
    await expect(page.locator('[data-testid="workflow-node-lib-keep"]')).toBeVisible()
    await expect(
      page.locator('[data-testid="action-bar-edit-function-button"]'),
    ).toBeVisible()

    // Undo is NOT blocked by the read-only drilled scope - the restored
    // baseline has no materialized body for fn-shared, so the view auto-pops.
    await clickUndo(page)
    await expect(page.locator('[data-testid="workflow-node-fn-shared"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-root-log"]')).toBeVisible()
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
    await expect(
      page.locator('[data-testid="action-bar-edit-function-button"]'),
    ).toHaveCount(0)
    // The move was undone together with the restore.
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.before)
    // The existing undo announcement is the orientation cue (toast mirror).
    await expect(page.getByText(/^Undone:/).first()).toBeVisible({ timeout: 5_000 })

    // Redo re-applies the move and stays at root - no crash either way.
    await clickRedo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.after)
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
    await expect(page.locator('[data-testid="canvas-page"]')).toBeVisible()
  })

  test('pop-out leaves no residue: edit-mode body edit undone after pop-out stays coherent', async ({
    page,
    request,
  }) => {
    // Pop-out never mutates the live tree silently
    // (fold/strip with no history entry), so an undo right after a pop-out
    // never re-materializes a stamped body outside any drill or desyncs dirty.
    const { testId } = await seedSharedRefTest(
      request,
      `V-UNDO-DRILL-RESIDUE ${randomUUID().slice(0, 8)}`,
    )
    await openTest(page, testId)

    // Pure drill-in / pop-out round trip neither dirties nor commits.
    await digIn(page, 'fn-shared')
    await expect(page.locator('[data-testid="workflow-node-lib-keep"]')).toBeVisible()
    await popToBreadcrumbSegment(page, /V-UNDO-DRILL-RESIDUE/)
    await expect(page.locator('[data-testid="workflow-node-fn-shared"]')).toBeVisible()
    await expect(saveBtn(page)).toBeDisabled()
    await expect(undoBtn(page)).toBeDisabled()

    // Enter edit mode (one entry), edit the draft body while drilled
    // (entry whose snapshot carries the drill stamp), then pop out.
    await clickNodeKebabItem(page, 'fn-shared', 'Edit')
    await expect(editModeOverlay(page, 'fn-shared')).toBeVisible({ timeout: 10_000 })
    await digIn(page, 'fn-shared')
    await expect(page.locator('[data-testid="workflow-node-lib-drop"]')).toBeVisible()
    await disableNode(page, 'lib-drop')
    await popToBreadcrumbSegment(page, /V-UNDO-DRILL-RESIDUE/)
    await expect(page.locator('[data-testid="workflow-node-fn-shared"]')).toBeVisible()

    // Undo right after the pop-out reverts the body edit only: still at root,
    // still in edit mode, no stray body nodes leaked into the root canvas.
    await clickUndo(page)
    await expect(editModeOverlay(page, 'fn-shared')).toBeVisible()
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
    await expect(workflowNodes(page)).toHaveCount(2)
    await expect(page.locator('[data-testid="workflow-node-lib-drop"]')).toHaveCount(0)

    // Drill back in: the disable was undone inside the draft body.
    await digIn(page, 'fn-shared')
    await expect(page.locator('[data-testid="workflow-node-lib-drop"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-lib-drop"]')).not.toHaveAttribute(
      'data-disabled',
      'true',
    )
    await popToBreadcrumbSegment(page, /V-UNDO-DRILL-RESIDUE/)

    // One more undo exits edit mode cleanly (the single enter-edit entry).
    await clickUndo(page)
    await expect(editModeOverlay(page, 'fn-shared')).toHaveCount(0, { timeout: 5_000 })
    await expect(undoBtn(page)).toBeDisabled()
    await expect(saveBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeEnabled()
  })
})
