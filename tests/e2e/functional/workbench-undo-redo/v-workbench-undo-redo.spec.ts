/**
 * V-WORKBENCH-UNDO-REDO: Workbench undo/redo end-to-end coverage.
 *
 * Locks the post-state-baseline history model in the workflow store from
 * the user's perspective. Four scenarios:
 *
 * 1. The user's 4-step spec: drop a Log block (auto-connects to the start
 *    node, 2 history entries), edit config message twice (2 more history
 *    entries). Click Undo 4 times - assert each click changes the canvas
 *    meaningfully (text reverts, text reverts, edge disappears, node
 *    disappears). Click Redo 4 times - canvas walks back to the fully
 *    configured state. Proves the click-twice off-by-one is gone.
 * 2. Drag a node and release. Undo snaps it back to the original position.
 *    Redo returns it to the dropped position.
 * 3. Edit a Note's text and commit. Undo reverts the text. Redo restores it.
 * 4. After Save (markSaved seeds the new baseline), Undo is disabled - the
 *    save floored the history stack.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'
import { fieldInput } from '../../helpers/value-field'

const BASE = `http://localhost:${BACKEND_PORT}`

const FIXTURE_FOR_SAVE = {
  name: 'undo-redo save floor fixture',
  version: '1.0.0',
  description: 'Single Log node so we can edit + Save and assert undo is disabled.',
  workflow: {
    nodes: [
      {
        id: 'log-only',
        type: 'workflowNode',
        position: { x: 200, y: 200 },
        data: {
          label: 'Log',
          elementType: 'log',
          nodeType: 'plugin',
          category: 'system',
          version: '1.0.0',
          description: 'Log Only',
          hasNewerVersion: false,
          // Leave expressionFields off so the modal renders the regular
          // string Input, matching the behavior of a freshly-dropped Log.
          expressionFields: [],
          templateFields: [],
          variableExpressionKeys: [],
          config: {
            values: { message: 'initial', level: 'INFO' },
            outputBindings: {},
            profileBindings: [],
          },
        },
        measured: { width: 120, height: 62 },
      },
    ],
    edges: [
      { id: 'e1', source: 'start-node', target: 'log-only', type: 'default' },
    ],
  },
  variables: {},
  metadata: {},
  created_at: '2026-04-28T00:00:00.000000',
  updated_at: '2026-04-28T00:00:00.000000',
}

// ---------------------------------------------------------------------------
// Locators / helpers
// ---------------------------------------------------------------------------

const undoBtn = (page: Page) => page.locator('[data-testid="toolbar-undo-button"]')
const redoBtn = (page: Page) => page.locator('[data-testid="toolbar-redo-button"]')
const saveBtn = (page: Page) => page.locator('[data-testid="toolbar-save-button"]')

const workflowNodes = (page: Page) =>
  page.locator('[data-testid^="workflow-node-"][data-nodetype]')

const noteNodes = (page: Page) => page.locator('[data-testid^="note-node-"]')
// Exclude the synthetic Start->onboarding "ghost-edge" that the empty
// canvas renders as a UI hint - it is not a user edge and is unaffected
// by undo/redo.
const reactFlowEdges = (page: Page) =>
  page.locator('.react-flow__edge:not([data-id="ghost-edge"])')

async function gotoDraftWorkbench(page: Page) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto('/workbench?newTest=true')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench?newTest=true')
  await waitForCanvasLoad(page)
}

async function dropLogBelowStart(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  const startNode = page.locator('[data-testid="start-node"]')
  const startNodeBox = await startNode.boundingBox()
  // Drop within auto-connect proximity (ELEMENT_PROXIMITY_THRESHOLD = 100px,
  // dy > -20 required). Use a 60px gap below Start.
  const dropX = startNodeBox!.x - canvasBox!.x + startNodeBox!.width / 2
  const dropY = startNodeBox!.y - canvasBox!.y + startNodeBox!.height + 60

  const before = await workflowNodes(page).count()
  await dragPaletteItemToCanvas(page, { term: 'log', testId: 'palette-item-log' }, { x: dropX, y: dropY })
  await expect(workflowNodes(page)).toHaveCount(before + 1, { timeout: 5000 })
  // Auto-connect proximity edge must exist.
  await expect(reactFlowEdges(page).first()).toBeVisible({ timeout: 5000 })
}

async function dropNoteBelowStart(page: Page) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const canvasBox = await canvas.boundingBox()
  const startNode = page.locator('[data-testid="start-node"]')
  const startNodeBox = await startNode.boundingBox()
  // Drop a Note off to the side - notes have no auto-connect, position
  // doesn't matter for connectivity.
  const dropX = startNodeBox!.x - canvasBox!.x + 240
  const dropY = startNodeBox!.y - canvasBox!.y + 240

  const before = await noteNodes(page).count()
  await dragPaletteItemToCanvas(
    page,
    { term: 'note', testId: 'palette-item-note' },
    { x: dropX, y: dropY }
  )
  await expect(noteNodes(page)).toHaveCount(before + 1, { timeout: 5000 })
}

async function openConfigForFirstWorkflowNode(page: Page) {
  await workflowNodes(page).first().dblclick()
  const modal = configSheet(page)
  await expect(modal).toBeVisible({ timeout: 5000 })
  return modal
}

async function setMessageAndSaveConfig(page: Page, value: string) {
  const modal = await openConfigForFirstWorkflowNode(page)
  // Log's literal `message` string edits through the shared "Edit value" sheet.
  await setStringParam(modal, page, 'message', value)
  // Modal save button is the only "Save" inside the modal.
  await modal.getByRole('button', { name: /^Save$/ }).click()
  await expect(modal).toBeHidden({ timeout: 5_000 })
}

async function readMessageValue(page: Page): Promise<string> {
  const modal = await openConfigForFirstWorkflowNode(page)
  const box = fieldInput(modal, 'message')
  await expect(box).toBeVisible({ timeout: 5_000 })
  // The one value field holds the message as its text; nothing set reads empty.
  const text = await box.inputValue()
  await modal.getByRole('button', { name: /^Cancel$/ }).click()
  await expect(modal).toBeHidden({ timeout: 5_000 })
  return text
}

async function clickUndo(page: Page) {
  await expect(undoBtn(page)).toBeEnabled()
  await undoBtn(page).click()
}

async function clickRedo(page: Page) {
  await expect(redoBtn(page)).toBeEnabled()
  await redoBtn(page).click()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Workbench undo/redo (post-state baseline model)', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  })

  test('user 4-step scenario: drop + 2 config saves yield 4 undos / 4 redos with no click-twice', async ({
    page,
  }) => {
    await gotoDraftWorkbench(page)

    // Step 1: drop a Log block near Start so proximity auto-connects.
    // History entries produced: add-node + add-edge = 2.
    await dropLogBelowStart(page)
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(reactFlowEdges(page)).toHaveCount(1)

    // Step 2: edit config -> message=first. 1 history entry.
    await setMessageAndSaveConfig(page, 'first')
    expect(await readMessageValue(page)).toBe('first')

    // Step 3: edit config -> message=second. 1 history entry.
    await setMessageAndSaveConfig(page, 'second')
    expect(await readMessageValue(page)).toBe('second')

    // 4 history entries above the baseline. Undo 4 times.
    // The toolbar exposes Undo as enabled the whole way down to the baseline.
    await expect(undoBtn(page)).toBeEnabled()

    // Undo 1: reverts the second config save (second -> first).
    await clickUndo(page)
    expect(await readMessageValue(page)).toBe('first')
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(reactFlowEdges(page)).toHaveCount(1)

    // Undo 2: reverts the first config save (first -> "" / cleared).
    await clickUndo(page)
    const cleared = await readMessageValue(page)
    expect(cleared, `expected cleared message, got "${cleared}"`).toBe('')
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(reactFlowEdges(page)).toHaveCount(1)

    // Undo 3: reverts the auto-connect edge (edge gone, node still there).
    await clickUndo(page)
    await expect(reactFlowEdges(page)).toHaveCount(0)
    await expect(workflowNodes(page)).toHaveCount(1)

    // Undo 4: reverts the node add (canvas back to baseline).
    await clickUndo(page)
    await expect(workflowNodes(page)).toHaveCount(0)
    await expect(reactFlowEdges(page)).toHaveCount(0)

    // At the baseline Undo must be disabled.
    await expect(undoBtn(page)).toBeDisabled()

    // Now redo 4 times - canvas walks back to fully configured.
    await clickRedo(page) // re-add node
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(reactFlowEdges(page)).toHaveCount(0)

    await clickRedo(page) // re-add auto-connect edge
    await expect(workflowNodes(page)).toHaveCount(1)
    await expect(reactFlowEdges(page)).toHaveCount(1)

    await clickRedo(page) // first config save (message='first')
    expect(await readMessageValue(page)).toBe('first')

    await clickRedo(page) // second config save (message='second')
    expect(await readMessageValue(page)).toBe('second')

    await expect(redoBtn(page)).toBeDisabled()
  })

  test('drag-undo: a moved node snaps back on undo and forward on redo', async ({ page }) => {
    await gotoDraftWorkbench(page)
    await dropLogBelowStart(page)

    const node = workflowNodes(page).first()
    await node.hover()

    // Read the node position from the React Flow wrapper's inline
    // `transform` style. React Flow stores nodes in canvas-coords, so
    // this is invariant under viewport pan/zoom - the bounding-box
    // approach is fragile under any viewport shift the drag may cause.
    async function readTransform(): Promise<string> {
      return await node.evaluate((el) => {
        const rfNode = el.closest('.react-flow__node')
        return rfNode ? (rfNode as HTMLElement).style.transform : ''
      })
    }

    const startTransform = await readTransform()
    expect(startTransform, 'node has a transform after drop').toMatch(/translate/)

    const startBox = await node.boundingBox()
    expect(startBox).toBeTruthy()
    const grab = { x: startBox!.x + startBox!.width / 2, y: startBox!.y + startBox!.height / 2 }
    const target = { x: grab.x + 120, y: grab.y + 60 }

    await page.mouse.move(grab.x, grab.y)
    await page.mouse.down()
    // `steps: 10` makes Playwright dispatch 10 intermediate pointermove
    // events along the path. React Flow's drag detection needs more than
    // a single teleport to register the drag and fire onNodeDragStart.
    await page.mouse.move(target.x, target.y, { steps: 10 })
    await page.mouse.up()

    const movedTransform = await readTransform()
    expect(
      movedTransform,
      `drag must change the node transform - start=${startTransform} moved=${movedTransform}`,
    ).not.toBe(startTransform)

    // Drag must have produced exactly one history entry - Undo enabled.
    await expect(undoBtn(page)).toBeEnabled()
    await clickUndo(page)
    // Wait for the undo to land in the DOM. We poll `readTransform`
    // until it matches the start transform.
    await expect
      .poll(async () => readTransform(), { timeout: 5_000 })
      .toBe(startTransform)

    await clickRedo(page)
    await expect
      .poll(async () => readTransform(), { timeout: 5_000 })
      .toBe(movedTransform)
  })

  test('note-text undo: editing a Note text reverts on undo and restores on redo', async ({
    page,
  }) => {
    await gotoDraftWorkbench(page)
    await dropNoteBelowStart(page)

    const note = noteNodes(page).first()
    // Note's action row (with note-configure) only mounts when the note
    // is selected as the sole selection or already editing. Double-click
    // bypasses the action row entirely - the production `onDblClick`
    // handler calls `enterEditMode` directly (note-node.tsx:203).
    await note.dblclick()
    const editor = note.locator('[data-testid="note-text-editor"]')
    await expect(editor).toBeVisible({ timeout: 5_000 })
    await editor.fill('hello world')
    // Accept lives in the now-visible action row. After accept, the
    // store commits one history entry via `commitEdit` -> `commitHistory`.
    await note.locator('[data-testid="note-edit-accept"]').click()
    await expect(note.locator('[data-testid="note-text-display"]')).toHaveText('hello world', {
      timeout: 5_000,
    })

    await expect(undoBtn(page)).toBeEnabled()
    await clickUndo(page)
    // Undo restores prior text. Original text on a fresh note is empty,
    // so the display element renders the placeholder string.
    const display = note.locator('[data-testid="note-text-display"]')
    await expect(display).toBeVisible()
    await expect(display).not.toHaveText('hello world')

    await clickRedo(page)
    await expect(note.locator('[data-testid="note-text-display"]')).toHaveText('hello world', {
      timeout: 5_000,
    })
  })

  test('save floors the stack: after Save the Undo button is disabled', async ({ page, request }) => {
    // Import a single-Log fixture so we have a saved test to edit.
    await request.delete(`${BASE}/workbench/session`).catch(() => {})
    const createResp = await request.post(`${BASE}/tests`, {
      data: { ...FIXTURE_FOR_SAVE, name: `${FIXTURE_FOR_SAVE.name} ${Date.now()}` },
    })
    expect(createResp.ok(), `POST /tests failed: ${createResp.status()}`).toBeTruthy()
    const created = (await createResp.json()) as Record<string, unknown>
    const data = (created.data ?? created) as Record<string, unknown>
    const testId = data.id as string

    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Loaded test starts at the markSaved-seeded baseline. Undo disabled.
    await expect(undoBtn(page)).toBeDisabled()

    // Make 2 edits via config-modal saves.
    await setMessageAndSaveConfig(page, 'edit-1')
    await setMessageAndSaveConfig(page, 'edit-2')
    await expect(undoBtn(page)).toBeEnabled()

    // Click the toolbar Save - this commits to the backend via direct save.
    await expect(saveBtn(page)).toBeEnabled()
    await saveBtn(page).click()

    // After save, markSaved seeds a fresh baseline. Undo must be disabled
    // because the user cannot rewind past a save.
    await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
    await expect(undoBtn(page)).toBeDisabled()
    await expect(redoBtn(page)).toBeDisabled()

    // A new edit re-enables Undo. Undo then takes us back to the saved
    // baseline (Undo disables again), proving the floor is exactly the save.
    await setMessageAndSaveConfig(page, 'edit-3')
    await expect(undoBtn(page)).toBeEnabled()
    await clickUndo(page)
    await expect(undoBtn(page)).toBeDisabled()
  })
})
