/**
 * V-FN-EDIT-PUBLISH-OUTCOMES (functional): the three-option publish outcome
 * (CANVAS-219..220) and its in-memory, no-forced-save semantics (CANVAS-221) plus
 * the single-step undo/redo pin flip (CANVAS-222).
 *
 * REQ: REQ-3.1.2.2 (Version control for Functions with metadata).
 *
 * All three drive the real edit-mode publish UI flow:
 *   node kebab -> Edit -> kebab -> Publish -> fill Changelog -> Publish ->
 *   the PublishOutcomeDialog (Cancel / Publish and keep Old / Publish and set New).
 *
 * Phase: functional-workflow (serial). Self-seeds via POST /functions + POST
 * /tests. No execution, so no environment is required.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import {
  clickNodeKebabItem,
  expectNodeKebabItem,
  dragSourceToCanvas,
  expandPalette,
  waitForCanvasLoad,
} from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-outcomes-1'

interface SeededFn {
  functionId: string
  version: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `outcomes_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-EDIT-PUBLISH-OUTCOMES seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: 'seed details',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, version: '1.0.0', name }
}

async function seedTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-EDIT-PUBLISH-OUTCOMES ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance at v1.0.0',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 320, y: 180 },
            data: {
              label: shared.name,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId: shared.functionId,
              functionVersion: shared.version,
              originalLibraryName: shared.name,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
            },
            measured: { width: 120, height: 62 },
          },
        ],
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success, `POST /tests: ${resp.status()}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

const overlayLocator = (page: Page) =>
  page.locator(
    `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
  )

/** Enter edit mode, open the publish dialog, fill the mandatory Changelog and
 *  click Publish to surface the three-option outcome modal. Returns it. */
async function reachOutcomeModal(page: Page) {
  await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
  await expect(overlayLocator(page)).toBeVisible({ timeout: 10_000 })

  await clickNodeKebabItem(page, FN_NODE_ID, 'Publish')
  const editDialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
  await expect(editDialog).toBeVisible({ timeout: 10_000 })
  await editDialog
    .locator('[data-testid="publish-edit-mode-changelog-input"]')
    .fill('Outcomes regression guard')
  const publishBtn = editDialog.getByRole('button', { name: 'Publish' })
  await expect(publishBtn).not.toHaveAttribute('aria-disabled', 'true')
  await publishBtn.click()

  const outcome = page.locator('[role="alertdialog"]', { hasText: 'Publish a new version?' })
  await expect(outcome).toBeVisible({ timeout: 10_000 })
  return { outcome, editDialog }
}

/** Clear the Radix pointer-events lock that the AlertDialog can leave behind
 *  on a fast headless close, so the canvas stays interactive. */
async function clearPointerLock(page: Page) {
  await page.evaluate(() => {
    document.documentElement.style.pointerEvents = ''
    document.body.style.pointerEvents = ''
  })
}

/** Open the Shared instance config modal and assert its pinned version, then
 *  close it. The trigger renders `v{functionVersion}` for the live in-memory
 *  pin (publish/undo/redo do not save the Test). */
async function expectPinnedVersion(page: Page, version: string) {
  const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
  await node.locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  await expect(dialog.locator('[data-testid="version-dropdown-trigger"]')).toContainText(
    `v${version}`,
  )
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden({ timeout: 5_000 })
  await clearPointerLock(page)
}

async function libraryVersions(request: APIRequestContext, functionId: string): Promise<string[]> {
  const resp = await request.get(`${BACKEND_URL}/functions/${functionId}/versions`)
  expect(resp.ok(), `GET /versions: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data.versions as Array<{ version: string }>).map((v) => v.version)
}

test.describe('V-FN-EDIT-PUBLISH-OUTCOMES (functional): three-option publish outcomes', () => {
  test('Publish and keep Old publishes the new version but leaves the instance on the source', async ({
    page,
    request,
  }) => {
    // CANVAS-220: "Publish and keep Old" must publish the
    // new library version yet leave THIS instance pinned to its source version
    // (the draft is discarded, edit mode exits).
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    const { outcome, editDialog } = await reachOutcomeModal(page)
    await outcome.getByRole('button', { name: 'Publish and keep Old' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await expect(editDialog).toBeHidden({ timeout: 10_000 })
    await clearPointerLock(page)

    // The new version IS in the library...
    expect(await libraryVersions(request, shared.functionId)).toContain('1.0.1')
    // ...but the instance stayed on the source and left edit mode.
    await expect(overlayLocator(page)).toHaveCount(0, { timeout: 5_000 })
    await expectPinnedVersion(page, '1.0.0')
  })

  test('Publish does not force-save the Test and leaves other unsaved edits intact', async ({
    page,
    request,
  }) => {
    // CANVAS-221: publishing an edit-mode draft
    // must NOT save the Test and must NOT touch unrelated unsaved canvas edits.
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    // Add an unrelated, UNSAVED local Function node (dirties the canvas).
    await expandPalette(page)
    const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const box = await canvas.boundingBox()
    expect(box).toBeTruthy()
    await dragSourceToCanvas(page, newFnBtn, { x: box!.width * 0.6, y: box!.height * 0.55 })
    const fnNodes = page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
    await expect(fnNodes).toHaveCount(2)

    // Publish the SHARED instance via set New.
    const { outcome } = await reachOutcomeModal(page)
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await clearPointerLock(page)

    // The new version is in the library.
    expect(await libraryVersions(request, shared.functionId)).toContain('1.0.1')

    // The unrelated local Function is STILL on the canvas (not removed by publish).
    await expect(fnNodes).toHaveCount(2)

    // The Test on disk was NOT force-saved: it still holds exactly one Function
    // node (the original Shared) pinned to 1.0.0 - neither the unrelated local
    // Function nor the new version pin was persisted.
    const testResp = await request.get(`${BACKEND_URL}/tests/${testId}`)
    expect(testResp.ok()).toBeTruthy()
    const saved = await testResp.json()
    const savedFns = (saved.data.workflow.nodes as Array<Record<string, any>>).filter(
      (n) => n.data?.nodeType === 'function',
    )
    expect(savedFns).toHaveLength(1)
    expect(savedFns[0].id).toBe(FN_NODE_ID)
    expect(savedFns[0].data?.functionVersion).toBe('1.0.0')
  })

  test('A single undo flips the instance pin to the old version; redo re-pins to the new', async ({
    page,
    request,
  }) => {
    // CANVAS-222: publishing collapses the edit session into
    // ONE undoable version-flip on a clean reference - undo reverts the pin to
    // the source version (the draft is unreachable), redo re-pins to the new one.
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    const { outcome } = await reachOutcomeModal(page)
    await outcome.getByRole('button', { name: 'Publish and set New' }).click()
    await expect(outcome).toBeHidden({ timeout: 10_000 })
    await clearPointerLock(page)

    // Re-pinned to the new version on a clean reference (overlay gone).
    await expect(overlayLocator(page)).toHaveCount(0, { timeout: 5_000 })
    await expectPinnedVersion(page, '1.0.1')

    // One undo -> the pin reverts to the source version. The draft is NOT
    // reachable (the instance is a clean published ref, no edit-mode overlay).
    const undoBtn = page.locator('[data-testid="toolbar-undo-button"]')
    await expect(undoBtn).toBeEnabled()
    await undoBtn.click()
    await expect(overlayLocator(page)).toHaveCount(0, { timeout: 5_000 })
    await expectPinnedVersion(page, '1.0.0')

    // Redo -> re-pins to the published version.
    const redoBtn = page.locator('[data-testid="toolbar-redo-button"]')
    await expect(redoBtn).toBeEnabled()
    await redoBtn.click()
    await expectPinnedVersion(page, '1.0.1')

    // The kebab still offers Edit (a clean published ref, not an edit-mode draft).
    await expectNodeKebabItem(page, FN_NODE_ID, /^Edit$/)
  })
})
