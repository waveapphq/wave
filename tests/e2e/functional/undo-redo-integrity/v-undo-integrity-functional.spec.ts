/**
 * V-UNDO-INTEGRITY (functional): dirty truth, transient skip, and execution /
 * save gating of the change history.
 *
 * REQ: REQ-5.2.1.24 (Undo/redo support for critical operations).
 *
 * Pass Criteria:
 *   1. Ctrl+Z is inert mid-run; the toolbar buttons are disabled while the
 *      execution runs and availability returns at the terminal state.
 *   2. Skip/Unskip never light Undo and never enable Save; Disable stays a
 *      regular undoable entry.
 *   3. Derived dirty round-trip: a move enables Save, undoing back to the
 *      canonically-baseline-equal state disables it again.
 *   4. Save-while-drilled baselines the persisted (canonical) shape: Save
 *      disables, the persisted Test carries no transient drill body, and
 *      pop-out stays clean.
 *   5. Undo/redo refuse while a save request is in flight.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import {
  publishLibraryFunction,
  createValidTest,
  sharedNode,
  delayNode,
  logNode,
  startEdge,
  openTest,
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
  readNodeTransform,
  clickNodeContextMenuItem,
} from '../../helpers/workbench'
import { BACKEND_URL, E2E_ENV_NAME, ensureEnvironment } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

async function selectEnvironment(page: import('@playwright/test').Page): Promise<void> {
  await page.locator('[data-testid="environment-selector"]').click()
  const popover = page.locator('[data-testid="environment-popover"]')
  await expect(popover).toBeVisible()
  await popover.locator(`button:has-text("${E2E_ENV_NAME}")`).first().click()
  await expect(popover).not.toBeVisible()
}

test.describe('V-UNDO-INTEGRITY (functional): gating, skip transience, dirty truth', () => {
  test('undo is inert mid-run and available again after the terminal state', async ({
    page,
    request,
  }) => {
    // The keyboard path is gated like the toolbar - Ctrl+Z
    // never mutates the canvas mid-run.
    await ensureEnvironment(request)
    const testId = await createValidTest(request, {
      name: `V-UNDO-INT-RUN ${randomUUID().slice(0, 8)}`,
      nodes: [
        delayNode('delay-1', 'Hold', 8000, { x: 200, y: 160 }),
        logNode('after-log', 'After', "'run-done'", { x: 200, y: 300 }),
      ],
      edges: [startEdge('delay-1'), { id: 'e-d-a', source: 'delay-1', target: 'after-log' }],
    })
    await openTest(page, testId)

    const drag = await dragNodeBy(page, 'after-log', { confirmTestId: 'toolbar-save-button' })
    await expect(undoBtn(page)).toBeEnabled()

    await selectEnvironment(page)
    await page.locator('[data-testid="run-button"]').click()
    const status = page.locator('[data-testid="workflow-status"]')
    await expect(status).toHaveAttribute('data-status', 'running', { timeout: 15_000 })

    // Buttons disabled while running (single availability truth).
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeDisabled()

    // Keyboard undo is refused by the same store gate: no canvas change.
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    expect(await readNodeTransform(page, 'after-log')).toBe(drag.after)

    // Terminal state: availability returns and undo now works.
    await expect(status).not.toHaveAttribute('data-status', 'running', { timeout: 60_000 })
    await expect(status).toHaveAttribute('data-status', /passed|success/, { timeout: 10_000 })
    await expect(undoBtn(page)).toBeEnabled()
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'after-log'), { timeout: 5_000 })
      .toBe(drag.before)
  })

  test('Skip/Unskip never light Undo and never enable Save; Disable stays undoable', async ({
    page,
    request,
  }) => {
    // Skip ops never commit dead history entries whose
    // redo could fake-dirty the canvas. Skip is runtime-transient.
    const testId = await createValidTest(request, {
      name: `V-UNDO-INT-SKIP ${randomUUID().slice(0, 8)}`,
      nodes: [logNode('log-1', 'Log', "'line-1'", { x: 200, y: 200 })],
      edges: [startEdge('log-1')],
    })
    await openTest(page, testId)
    const node = page.locator('[data-testid="workflow-node-log-1"]')
    await expect(undoBtn(page)).toBeDisabled()
    await expect(saveBtn(page)).toBeDisabled()

    await clickNodeContextMenuItem(page, 'log-1', /^Skip$/)
    await expect(node).toHaveAttribute('data-skipped', 'true')
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeDisabled()
    await expect(saveBtn(page)).toBeDisabled()

    await clickNodeContextMenuItem(page, 'log-1', /^Unskip$/)
    await expect(node).not.toHaveAttribute('data-skipped', 'true')
    await expect(undoBtn(page)).toBeDisabled()
    await expect(saveBtn(page)).toBeDisabled()

    // Disable is persisted state and therefore a regular undoable entry.
    await clickNodeContextMenuItem(page, 'log-1', /^Disable$/)
    await expect(node).toHaveAttribute('data-disabled', 'true')
    await expect(undoBtn(page)).toBeEnabled()
    await expect(saveBtn(page)).toBeEnabled()
    await clickUndo(page)
    await expect(node).not.toHaveAttribute('data-disabled', 'true')
    await expect(undoBtn(page)).toBeDisabled()
    await expect(saveBtn(page)).toBeDisabled()
  })

  test('save-while-drilled baselines the canonical shape; dirty stays honest', async ({
    page,
    request,
  }) => {
    const lib = await publishLibraryFunction(request, {
      name: `INT-Lib-${randomUUID().slice(0, 6)}`,
      workflow: {
        nodes: [logNode('lib-body', 'Body', "'lib-line'", { x: 200, y: 200 })],
        edges: [startEdge('lib-body')],
      },
    })
    const testId = await createValidTest(request, {
      name: `V-UNDO-INT-DIRTY ${randomUUID().slice(0, 8)}`,
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
    await openTest(page, testId)

    // Dirty the canvas, then save WHILE DRILLED into the Shared (the live
    // tree carries the transient drill stamp at that moment).
    await dragNodeBy(page, 'root-log', { confirmTestId: 'toolbar-save-button' })
    await digIn(page, 'fn-shared')
    await expect(page.locator('[data-testid="workflow-node-lib-body"]')).toBeVisible({
      timeout: 10_000,
    })
    await expect(saveBtn(page)).toBeEnabled()
    await saveBtn(page).click()

    // markSaved baselines the CANONICAL tree, so the
    // freshly saved canvas reads clean even though the live tree is stamped.
    await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
    await expect(undoBtn(page)).toBeDisabled()

    // The persisted Test holds the persistence shape: no transient drill body
    // on the Shared reference (save-side sanitize).
    const saved = await (await request.get(`${BACKEND_URL}/tests/${testId}`)).json()
    const savedShared = (saved.data.workflow.nodes as Array<Record<string, any>>).find(
      (n) => n.id === 'fn-shared',
    )
    expect(savedShared, 'shared node persisted').toBeTruthy()
    expect(
      savedShared!.data.localDefinition,
      'transient drill body must not persist on a clean Shared reference',
    ).toBeUndefined()

    // Pop-out residue cleanup never dirties a just-saved canvas.
    await popToBreadcrumbSegment(page, /V-UNDO-INT-DIRTY/)
    await expect(saveBtn(page)).toBeDisabled()

    // Derived dirty round-trip: move -> Save enables; undo back to
    // the canonically-baseline-equal state -> Save disables again.
    const drag2 = await dragNodeBy(page, 'root-log', { confirmTestId: 'toolbar-save-button' })
    await expect(saveBtn(page)).toBeEnabled()
    await clickUndo(page)
    await expect
      .poll(async () => readNodeTransform(page, 'root-log'), { timeout: 5_000 })
      .toBe(drag2.before)
    await expect(saveBtn(page)).toBeDisabled()
    await clickRedo(page)
    await expect(saveBtn(page)).toBeEnabled()
  })

  test('undo/redo refuse while a save request is in flight', async ({ page, request }) => {
    // Best-effort: the save round-trip is delayed via route
    // interception so the in-flight window is wide enough to assert.
    const testId = await createValidTest(request, {
      name: `V-UNDO-INT-SAVEFLIGHT ${randomUUID().slice(0, 8)}`,
      nodes: [logNode('log-1', 'Log', "'line-1'", { x: 200, y: 200 })],
      edges: [startEdge('log-1')],
    })
    await openTest(page, testId)

    const drag = await dragNodeBy(page, 'log-1', { confirmTestId: 'toolbar-save-button' })

    await page.route(`**/tests/${testId}`, async (route) => {
      if (route.request().method() === 'PUT') {
        await new Promise((resolve) => setTimeout(resolve, 1500))
      }
      await route.continue()
    })

    await saveBtn(page).click()

    // While the PUT is pending: both controls unavailable, keyboard inert.
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeDisabled()
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(200)
    expect(await readNodeTransform(page, 'log-1')).toBe(drag.after)

    // After the save lands the canvas is baselined: clean, floored, position kept.
    await expect(saveBtn(page)).toBeDisabled({ timeout: 15_000 })
    await expect(undoBtn(page)).toBeDisabled()
    expect(await readNodeTransform(page, 'log-1')).toBe(drag.after)
    await page.unroute(`**/tests/${testId}`)
  })
})
