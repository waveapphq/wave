/**
 * V-UNDO-LIFECYCLE (functional): Function lifecycle actions vs the change
 * history.
 *
 * REQ: REQ-5.2.1.24 (Undo/redo support for critical operations).
 *
 * Pass Criteria:
 *   1. Enter edit mode is exactly ONE undoable entry.
 *   2. Make Local is exactly ONE undoable entry; the library is untouched by
 *      undo.
 *   3. First publish (local to shared) is NOT undoable; the function's prior
 *      body edits are picked out; unrelated edits stay undoable.
 *   4. Drop changes truncates the redo tail.
 *   5. Selection-residue dedup: drop after interleaved moves leaves exactly
 *      the two Move steps, no dead Enter-edit step.
 *   6. Publish keep-old: an unrelated edit interleaved inside the edit session
 *      survives as its own undo step; nothing else is undoable.
 *   7. Publish set-new appends exactly ONE version-flip entry; undo/redo of
 *      the flip re-reconciles the instance contract.
 *   8. Drop while drilled deeper pops to the nearest valid scope, in-Test and
 *      in the library View.
 *   9. Publish while drilled refreshes the drilled body, in-Test and in the
 *      library View.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, expectNodeKebabItem, openNodeKebab } from '../../helpers/canvas'
import {
  publishLibraryFunction,
  createValidTest,
  localFunctionNode,
  sharedNode,
  editModeSharedNode,
  logNode,
  startEdge,
  openTest,
  openFunctionView,
} from '../../helpers/fn-seed'
import {
  undoBtn,
  redoBtn,
  clickUndo,
  clickRedo,
  dragNodeBy,
  digIn,
  disableNode,
  popToBreadcrumbSegment,
  breadcrumbFunctionSegments,
  readNodeTransform,
  editModeOverlay,
  expectPinnedVersion,
  expectNodeKebabItemThenClose,
  clearPointerLock,
  configSheet,
} from '../../helpers/workbench'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

async function libraryVersions(
  request: APIRequestContext,
  functionId: string,
): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/functions/${functionId}/versions`)
  expect(resp.ok(), `GET /versions: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data.versions as Array<{ version: string }>).map((v) => v.version)
}

/** Drive the edit-mode publish dialog through to the three-option outcome
 *  modal and click the given outcome button. */
async function publishEditModeVia(
  page: Page,
  nodeId: string,
  outcomeButton: 'Publish and keep Old' | 'Publish and set New',
  opts: { viaChrome?: boolean } = {},
): Promise<void> {
  if (opts.viaChrome) {
    await page.locator('[data-testid="action-bar-publish-button"]').click()
  } else {
    await clickNodeKebabItem(page, nodeId, 'Publish')
  }
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await dialog
    .locator('[data-testid="publish-edit-mode-changelog-input"]')
    .fill('V-UNDO-LIFECYCLE publish')
  // Details is mandatory; seeded library entries carry an empty details field.
  await dialog
    .locator('[data-testid="publish-edit-mode-details-input"]')
    .fill('V-UNDO-LIFECYCLE details')
  const publishBtn = dialog.getByRole('button', { name: 'Publish' })
  await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
  await publishBtn.click()
  const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
  await expect(outcome).toBeVisible({ timeout: 10_000 })
  await outcome.getByRole('button', { name: outcomeButton }).click()
  await expect(outcome).toBeHidden({ timeout: 10_000 })
  await expect(dialog).toBeHidden({ timeout: 10_000 })
  await clearPointerLock(page)
}

/** Kebab Drop changes -> confirm the destructive dialog. */
async function dropChangesViaKebab(page: Page, nodeId: string): Promise<void> {
  await clickNodeKebabItem(page, nodeId, 'Drop changes')
  const confirm = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
  await expect(confirm).toBeVisible({ timeout: 5_000 })
  await confirm.getByRole('button', { name: 'Drop changes' }).click()
  await expect(confirm).toBeHidden({ timeout: 5_000 })
  await clearPointerLock(page)
}

test.describe('V-UNDO-LIFECYCLE (functional): lifecycle actions vs history', () => {
  test('enter edit mode commits exactly ONE undoable entry', async ({
    page,
    request,
  }) => {
    // Entering edit mode commits an entry, so the first
    // in-edit undo never silently exits edit mode and loses the draft.
    const lib = await publishLibraryFunction(request, { name: `UL-A-${randomUUID().slice(0, 6)}` })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-A ${randomUUID().slice(0, 8)}`,
      nodes: [sharedNode('fn-a', { functionId: lib.functionId, functionVersion: lib.version, label: lib.name })],
      edges: [startEdge('fn-a')],
    })
    await openTest(page, testId)
    await expect(undoBtn(page)).toBeDisabled()

    await clickNodeKebabItem(page, 'fn-a', 'Edit')
    await expect(editModeOverlay(page, 'fn-a')).toBeVisible({ timeout: 10_000 })
    await expect(undoBtn(page)).toBeEnabled()

    // ONE undo exits edit mode cleanly; the stack is floored right after.
    await clickUndo(page)
    await expect(editModeOverlay(page, 'fn-a')).toHaveCount(0, { timeout: 5_000 })
    await expectNodeKebabItemThenClose(page, 'fn-a', /^Edit$/)
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeEnabled()

    // Redo re-enters edit mode (markers + draft restored).
    await clickRedo(page)
    await expect(editModeOverlay(page, 'fn-a')).toBeVisible({ timeout: 5_000 })
    await expectNodeKebabItem(page, 'fn-a', 'Drop changes')
  })

  test('Make Local commits exactly ONE undoable entry; the library survives undo', async ({
    page,
    request,
  }) => {
    // Make Local never rewrites the node via raw updateNode
    // with no history entry, so undo never resurrects a stale node from an
    // older entry while the library keeps the new state.
    const lib = await publishLibraryFunction(request, { name: `UL-B-${randomUUID().slice(0, 6)}` })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-B ${randomUUID().slice(0, 8)}`,
      nodes: [sharedNode('fn-b', { functionId: lib.functionId, functionVersion: lib.version, label: lib.name })],
      edges: [startEdge('fn-b')],
    })
    await openTest(page, testId)

    const badge = page.locator(
      '[data-testid="workflow-node-fn-b"] [data-testid="node-function-lifecycle-badge"]',
    )
    await expect(badge).toHaveAttribute('data-state', 'shared')

    const menu = await openNodeKebab(page, 'fn-b')
    await menu.getByRole('menuitem', { name: 'Make Local…' }).click()
    const dialog = page.locator('[role="alertdialog"]', { hasText: 'Make Local' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    await dialog.getByRole('button', { name: 'Make Local' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await clearPointerLock(page)
    await expect(badge).toHaveAttribute('data-state', 'local')

    // ONE undo restores the shared instance; the stack is floored after it.
    await clickUndo(page)
    await expect(badge).toHaveAttribute('data-state', 'shared')
    await expectNodeKebabItemThenClose(page, 'fn-b', /^Edit$/)
    await expect(undoBtn(page)).toBeDisabled()

    // Undo reverts the canvas only - the library entry is untouched.
    const libResp = await request.get(`${BACKEND_URL}/functions/${lib.functionId}`)
    expect(libResp.ok(), 'library entry must survive the undo').toBeTruthy()

    // Redo re-applies the local rewrite.
    await clickRedo(page)
    await expect(badge).toHaveAttribute('data-state', 'local')
    await expectNodeKebabItem(page, 'fn-b', 'Publish to Library')
  })

  test('first publish is NOT undoable; prior body edits are picked out; unrelated edits stay', async ({
    page,
    request,
  }) => {
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-C ${randomUUID().slice(0, 8)}`,
      nodes: [
        logNode('root-log', 'RootLog', "'root-line'", { x: 200, y: 140 }),
        localFunctionNode(
          'fn-c',
          'Function_1',
          {
            nodes: [logNode('inner-c', 'Inner', "'inner-line'", { x: 200, y: 180 })],
            edges: [startEdge('inner-c')],
          },
          { x: 200, y: 300 },
        ),
      ],
      edges: [startEdge('root-log'), { id: 'e-rl-fc', source: 'root-log', target: 'fn-c' }],
    })
    await openTest(page, testId)

    // Unrelated edit (entry 1) + a Function body edit (entry 2).
    const drag = await dragNodeBy(page, 'root-log', { confirmTestId: 'toolbar-save-button' })
    await digIn(page, 'fn-c')
    await disableNode(page, 'inner-c')
    await popToBreadcrumbSegment(page, /V-UNDO-LC-C/)

    // First publish via the kebab dialog.
    await clickNodeKebabItem(page, 'fn-c', 'Publish to Library')
    const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const uniqueName = `ULC ${randomUUID().slice(0, 8)}`
    await dialog.locator('[data-testid="publish-name-input"]').fill(uniqueName)
    await dialog.getByRole('button', { name: 'Publish' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await clearPointerLock(page)

    const badge = page.locator(
      '[data-testid="workflow-node-fn-c"] [data-testid="node-function-lifecycle-badge"]',
    )
    await expect(badge).toHaveAttribute('data-state', 'shared')

    // The library entry exists.
    const listResp = await request.get(`${BACKEND_URL}/functions?q=${encodeURIComponent(uniqueName)}`)
    const list = await listResp.json()
    expect(list.data.find((f: { name: string }) => f.name === uniqueName)).toBeTruthy()

    // Undo 1: the unrelated move reverts; the conversion does NOT.
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.before)
    await expect(badge).toHaveAttribute('data-state', 'shared')

    // The function's prior body edit was picked out - nothing else to undo.
    await expect(undoBtn(page)).toBeDisabled()

    // Redo re-applies the move; the instance stays shared throughout.
    await clickRedo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.after)
    await expect(badge).toHaveAttribute('data-state', 'shared')
  })

  test('Drop changes truncates the redo tail', async ({ page, request }) => {
    // Surgery is a branch point - a redo future captured
    // before the drop must not be replayable.
    const lib = await publishLibraryFunction(request, { name: `UL-D-${randomUUID().slice(0, 6)}` })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-D ${randomUUID().slice(0, 8)}`,
      nodes: [
        logNode('root-log', 'RootLog', "'root-line'", { x: 200, y: 140 }),
        sharedNode('fn-d', {
          functionId: lib.functionId,
          functionVersion: lib.version,
          label: lib.name,
          position: { x: 200, y: 300 },
        }),
      ],
      edges: [startEdge('root-log'), { id: 'e-rl-fd', source: 'root-log', target: 'fn-d' }],
    })
    await openTest(page, testId)

    // Enter edit via the UI (so the saved baseline stays a clean reference),
    // then stack a move on top and undo it to leave a redo future.
    await clickNodeKebabItem(page, 'fn-d', 'Edit')
    await expect(editModeOverlay(page, 'fn-d')).toBeVisible({ timeout: 10_000 })
    const drag = await dragNodeBy(page, 'root-log')
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.before)
    await expect(redoBtn(page)).toBeEnabled()

    await dropChangesViaKebab(page, 'fn-d')
    await expect(editModeOverlay(page, 'fn-d')).toHaveCount(0, { timeout: 5_000 })

    // The pre-drop redo future is gone and the picked-out enter-edit
    // entry deduped against the clean baseline - nothing on either side.
    await expect(redoBtn(page)).toBeDisabled()
    await expect(undoBtn(page)).toBeDisabled()
  })

  test('drop after interleaved moves keeps exactly the two Move steps', async ({
    page,
    request,
  }) => {
    // Move A, enter edit, move B, Drop, undo x2 must yield
    // exactly two Move steps. React Flow `selected` residue must not defeat the
    // no-op dedup and leave a dead "Enter edit mode" undo/redo step behind.
    const lib = await publishLibraryFunction(request, { name: `UL-E-${randomUUID().slice(0, 6)}` })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-E ${randomUUID().slice(0, 8)}`,
      nodes: [
        logNode('log-a', 'LogA', "'line-a'", { x: 160, y: 120 }),
        logNode('log-b', 'LogB', "'line-b'", { x: 160, y: 420 }),
        sharedNode('fn-e', {
          functionId: lib.functionId,
          functionVersion: lib.version,
          label: lib.name,
          position: { x: 420, y: 260 },
        }),
      ],
      edges: [
        startEdge('log-a'),
        { id: 'e-a-b', source: 'log-a', target: 'log-b' },
        { id: 'e-b-e', source: 'log-b', target: 'fn-e' },
      ],
    })
    await openTest(page, testId)

    const dragA = await dragNodeBy(page, 'log-a', { confirmTestId: 'toolbar-save-button' })
    await clickNodeKebabItem(page, 'fn-e', 'Edit')
    await expect(editModeOverlay(page, 'fn-e')).toBeVisible({ timeout: 10_000 })
    const dragB = await dragNodeBy(page, 'log-b', { dx: -80, dy: 40 })

    await dropChangesViaKebab(page, 'fn-e')
    await expect(editModeOverlay(page, 'fn-e')).toHaveCount(0, { timeout: 5_000 })

    // Undo 1: move B reverts. NO edit-mode markers may reappear - a dead
    // "Enter edit mode" step would restore the overlay here.
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'log-b'), { timeout: 5_000 })
      .toBe(dragB.before)
    await expect(editModeOverlay(page, 'fn-e')).toHaveCount(0)

    // Undo 2: move A reverts.
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'log-a'), { timeout: 5_000 })
      .toBe(dragA.before)
    await expect(editModeOverlay(page, 'fn-e')).toHaveCount(0)

    // Exactly two steps - the dedup removed the no-op Enter-edit entry.
    await expect(undoBtn(page)).toBeDisabled()

    // Redo both moves; the instance stays a clean reference throughout.
    await clickRedo(page)
    await clickRedo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'log-b'), { timeout: 5_000 })
      .toBe(dragB.after)
    await expect(editModeOverlay(page, 'fn-e')).toHaveCount(0)
    await expect(redoBtn(page)).toBeDisabled()
  })

  test('publish keep-old: the interleaved unrelated edit survives as its own undo step', async ({
    page,
    request,
  }) => {
    const lib = await publishLibraryFunction(request, { name: `UL-F-${randomUUID().slice(0, 6)}` })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-F ${randomUUID().slice(0, 8)}`,
      nodes: [
        logNode('root-log', 'RootLog', "'root-line'", { x: 200, y: 140 }),
        sharedNode('fn-f', {
          functionId: lib.functionId,
          functionVersion: lib.version,
          label: lib.name,
          position: { x: 200, y: 300 },
        }),
      ],
      edges: [startEdge('root-log'), { id: 'e-rl-ff', source: 'root-log', target: 'fn-f' }],
    })
    await openTest(page, testId)

    await clickNodeKebabItem(page, 'fn-f', 'Edit')
    await expect(editModeOverlay(page, 'fn-f')).toBeVisible({ timeout: 10_000 })
    // Unrelated parent-scope edit interleaved INSIDE the edit session.
    const drag = await dragNodeBy(page, 'root-log')

    await publishEditModeVia(page, 'fn-f', 'Publish and keep Old')

    // New version in the library; this instance stays on the source pin.
    expect(await libraryVersions(request, lib.functionId)).toContain('1.0.1')
    await expect(editModeOverlay(page, 'fn-f')).toHaveCount(0, { timeout: 5_000 })
    await expectPinnedVersion(page, 'fn-f', '1.0.0')

    // The unrelated move is its own undo step; nothing else is undoable
    // (enter-edit was picked out, keep-old appended no entry).
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.before)
    await expect(editModeOverlay(page, 'fn-f')).toHaveCount(0)
    await expect(undoBtn(page)).toBeDisabled()

    await clickRedo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag.after)
    await expectPinnedVersion(page, 'fn-f', '1.0.0')
  })

  test('publish set-new: ONE version-flip entry; undo/redo reconciles the contract', async ({
    page,
    request,
  }) => {
    // The source version declares input `legacy_in`; the draft removes it, so the
    // Block in edit mode holds no field for it. The flip undo/redo moves the pin only.
    const lib = await publishLibraryFunction(request, {
      name: `UL-G-${randomUUID().slice(0, 6)}`,
      inputs: [{ name: 'legacy_in', type: 'string', required: false, default: '' }],
      workflow: {
        nodes: [logNode('lib-g', 'Body', "'g-line'", { x: 200, y: 200 })],
        edges: [startEdge('lib-g')],
      },
    })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-G ${randomUUID().slice(0, 8)}`,
      nodes: [
        editModeSharedNode('fn-g', {
          functionId: lib.functionId,
          functionVersion: lib.version,
          label: lib.name,
          position: { x: 200, y: 260 },
          draftWorkflow: {
            nodes: [logNode('lib-g', 'Body', "'g-line'", { x: 200, y: 200 })],
            edges: [startEdge('lib-g')],
          },
          draftInputs: [],
        }),
      ],
      edges: [startEdge('fn-g')],
    })
    await openTest(page, testId)
    await expect(editModeOverlay(page, 'fn-g')).toBeVisible({ timeout: 10_000 })

    await publishEditModeVia(page, 'fn-g', 'Publish and set New')

    const versions = await libraryVersions(request, lib.functionId)
    const newVersion = versions.find((v) => v !== '1.0.0')
    expect(newVersion, `a new version must exist; got ${versions.join(', ')}`).toBeTruthy()

    // Re-pinned to the new version, whose contract has no inputs.
    const node = page.locator('[data-testid="workflow-node-fn-g"]')
    const config = configSheet(page)
    await node.locator('button').first().dblclick()
    await expect(config).toBeVisible({ timeout: 10_000 })
    await expect(config.locator('[data-testid="version-dropdown-trigger"]')).toContainText(
      `v${newVersion}`,
    )
    await expect(config.getByText('legacy_in')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(config).toBeHidden({ timeout: 5_000 })
    await clearPointerLock(page)

    // Exactly ONE undoable entry: the version flip. Undoing it restores the
    // source pin in edit mode, whose window reads the draft's inputs, and floors the stack.
    await clickUndo(page)
    await node.locator('button').first().dblclick()
    await expect(config).toBeVisible({ timeout: 10_000 })
    await expect(config.locator('[data-testid="version-dropdown-trigger"]')).toContainText('v1.0.0')
    await expect(config.getByText('This Function declares no inputs.')).toBeVisible({ timeout: 10_000 })
    await expect(config.getByText('legacy_in')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(config).toBeHidden({ timeout: 5_000 })
    await clearPointerLock(page)
    await expect(undoBtn(page)).toBeDisabled()

    // Redo re-pins to the new version.
    await clickRedo(page)
    await node.locator('button').first().dblclick()
    await expect(config).toBeVisible({ timeout: 10_000 })
    await expect(config.locator('[data-testid="version-dropdown-trigger"]')).toContainText(
      `v${newVersion}`,
    )
    await expect(config.getByText('legacy_in')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(config).toBeHidden({ timeout: 5_000 })
    await clearPointerLock(page)
  })

  test('drop while drilled deeper pops to the nearest valid scope without crashing (in-Test)', async ({
    page,
    request,
  }) => {
    // Dropping a Function while drilled deeper than it never
    // strips the body of a node still on the drill path (render crash).
    const lib = await publishLibraryFunction(request, {
      name: `UL-H-${randomUUID().slice(0, 6)}`,
      workflow: {
        nodes: [
          localFunctionNode(
            'l2',
            'L2',
            {
              nodes: [logNode('l2-log', 'L2Log', "'l2-line'", { x: 200, y: 180 })],
              edges: [startEdge('l2-log')],
            },
            { x: 200, y: 160 },
          ),
        ],
        edges: [startEdge('l2')],
      },
    })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-H ${randomUUID().slice(0, 8)}`,
      nodes: [
        editModeSharedNode('fn-h', {
          functionId: lib.functionId,
          functionVersion: lib.version,
          label: lib.name,
          position: { x: 200, y: 260 },
          draftWorkflow: {
            nodes: [
              localFunctionNode(
                'l2',
                'L2',
                {
                  nodes: [logNode('l2-log', 'L2Log', "'l2-line'", { x: 200, y: 180 })],
                  edges: [startEdge('l2-log')],
                },
                { x: 200, y: 160 },
              ),
            ],
            edges: [startEdge('l2')],
          },
        }),
      ],
      edges: [startEdge('fn-h')],
    })
    await openTest(page, testId)

    // Drill two deep: into the edit-mode draft body, then into the local L2.
    await digIn(page, 'fn-h')
    await expect(page.locator('[data-testid="workflow-node-l2"]')).toBeVisible({ timeout: 10_000 })
    await digIn(page, 'l2')
    await expect(page.locator('[data-testid="workflow-node-l2-log"]')).toBeVisible()
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(2)

    // Drop changes from the drilled chrome (the deepest Shared is fn-h).
    await page.locator('[data-testid="action-bar-drop-changes-button"]').click()
    const confirm = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
    await expect(confirm).toBeVisible({ timeout: 5_000 })
    await confirm.getByRole('button', { name: 'Drop changes' }).click()
    await expect(confirm).toBeHidden({ timeout: 5_000 })
    await clearPointerLock(page)

    // No crash: the view popped to the Test root (the dropped Function's body
    // is no longer materialized); the instance is a clean reference again.
    await expect(page.locator('[data-testid="workflow-node-fn-h"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
    await expect(editModeOverlay(page, 'fn-h')).toHaveCount(0)
    await expectNodeKebabItem(page, 'fn-h', /^Edit$/)
  })

  test('View drop re-drills into the reverted published body', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `UL-I-${randomUUID().slice(0, 6)}`,
      workflow: {
        nodes: [
          logNode('view-keep', 'Keep', "'view-keep'", { x: 200, y: 160 }),
          logNode('view-drop', 'Drop', "'view-drop'", { x: 200, y: 300 }),
        ],
        edges: [startEdge('view-keep'), { id: 'e-vk-vd', source: 'view-keep', target: 'view-drop' }],
      },
    })
    await openFunctionView(page, fn.functionId, fn.version)

    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({
      timeout: 15_000,
    })
    await disableNode(page, 'view-drop')

    await page.locator('[data-testid="action-bar-drop-changes-button"]').click()
    const confirm = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
    await expect(confirm).toBeVisible({ timeout: 5_000 })
    await confirm.getByRole('button', { name: 'Drop changes' }).click()
    await expect(confirm).toBeHidden({ timeout: 5_000 })
    await clearPointerLock(page)

    // The View re-drills into the reverted PUBLISHED body: read-only chrome is
    // back and the disable edit is gone.
    await expect(page.locator('[data-testid="action-bar-edit-function-button"]')).toBeVisible({
      timeout: 15_000,
    })
    const dropNode = page.locator('[data-testid="workflow-node-view-drop"]')
    await expect(dropNode).toBeVisible()
    await expect(dropNode).not.toHaveAttribute('data-disabled', 'true')
    await expect(page.locator('[data-testid="workflow-node-view-keep"]')).toBeVisible()
  })

  test('publish while drilled refreshes the drilled body in place (in-Test)', async ({
    page,
    request,
  }) => {
    // In-Test publish-while-drilled never leaves the drilled
    // body as the markerless transient copy (the next undo would crash).
    const lib = await publishLibraryFunction(request, {
      name: `UL-J-${randomUUID().slice(0, 6)}`,
      workflow: {
        nodes: [logNode('inner-source-log', 'Body', "'source-line'", { x: 200, y: 200 })],
        edges: [startEdge('inner-source-log')],
      },
    })
    const testId = await createValidTest(request, {
      name: `V-UNDO-LC-J ${randomUUID().slice(0, 8)}`,
      nodes: [
        editModeSharedNode('fn-j', {
          functionId: lib.functionId,
          functionVersion: lib.version,
          label: lib.name,
          position: { x: 200, y: 260 },
          draftWorkflow: {
            nodes: [
              logNode('inner-source-log', 'Body', "'source-line'", { x: 200, y: 200 }),
              logNode('inner-draft-log', 'Body2', "'draft-line'", { x: 200, y: 340 }),
            ],
            edges: [
              startEdge('inner-source-log'),
              { id: 'e-is-id', source: 'inner-source-log', target: 'inner-draft-log' },
            ],
          },
        }),
      ],
      edges: [startEdge('fn-j')],
    })
    await openTest(page, testId)

    await digIn(page, 'fn-j')
    await expect(page.locator('[data-testid="workflow-node-inner-draft-log"]')).toBeVisible({
      timeout: 10_000,
    })

    await publishEditModeVia(page, 'fn-j', 'Publish and set New', { viaChrome: true })

    // Still drilled; the body now shows the freshly published version and the
    // chrome flipped to the read-only (clean Shared) variant.
    await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
    await expect(page.locator('[data-testid="workflow-node-inner-source-log"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('[data-testid="workflow-node-inner-draft-log"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-bar-edit-function-button"]')).toBeVisible({
      timeout: 15_000,
    })

    // Popping out shows the clean re-pinned instance (pinned to whatever
    // version the suggested bump published).
    await popToBreadcrumbSegment(page, /V-UNDO-LC-J/)
    await expect(editModeOverlay(page, 'fn-j')).toHaveCount(0, { timeout: 5_000 })
    const newVersion = (await libraryVersions(request, lib.functionId)).find((v) => v !== '1.0.0')
    expect(newVersion, 'a new library version exists after set-new').toBeTruthy()
    await expectPinnedVersion(page, 'fn-j', newVersion!)
  })

  test('View publish refreshes the View body and restores read-only chrome', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `UL-K-${randomUUID().slice(0, 6)}`,
      workflow: {
        nodes: [logNode('view-line', 'Body', "'view-line'", { x: 200, y: 200 })],
        edges: [startEdge('view-line')],
      },
    })
    await openFunctionView(page, fn.functionId, fn.version)

    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({
      timeout: 15_000,
    })
    await disableNode(page, 'view-line')

    await page.locator('[data-testid="action-bar-publish-button"]').click()
    const meta = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(meta).toBeVisible({ timeout: 10_000 })
    await meta
      .locator('[data-testid="publish-edit-mode-changelog-input"]')
      .fill('V-UNDO-LIFECYCLE view publish')
    await meta
      .locator('[data-testid="publish-edit-mode-details-input"]')
      .fill('V-UNDO-LIFECYCLE view details')
    await meta.getByRole('button', { name: 'Publish' }).click()
    const confirm = page.locator('[data-testid="publish-outcome-single-confirm"]')
    await expect(confirm).toBeVisible({ timeout: 8_000 })
    await confirm.click()
    await expect(confirm).toBeHidden({ timeout: 15_000 })
    await clearPointerLock(page)

    // The View switched to the new version: read-only chrome is back and the
    // refreshed body carries the published (disabled) node state.
    await expect(page.locator('[data-testid="action-bar-edit-function-button"]')).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.locator('[data-testid="workflow-node-view-line"]')).toBeVisible()
    await expect(page.locator('[data-testid="workflow-node-view-line"]')).toHaveAttribute(
      'data-disabled',
      'true',
    )
    const versions = await libraryVersions(request, fn.functionId)
    expect(versions.length, `published version list: ${versions.join(', ')}`).toBeGreaterThan(1)
  })
})
