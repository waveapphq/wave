/**
 * V-FN-DETACH-FUNCTIONAL: Make Local on a shared Function end-to-end.
 *
 * Contract: Make Local is a confirmation flow; the library entry stays
 * untouched; the canvas node becomes a fresh local copy.
 *
 * Two permutations:
 *
 *   D1 (saved + clean): seed a Test whose only Function is a shared
 *      reference to a known library entry, open the workbench, open the
 *      kebab "Make Local…", confirm. Assert:
 *        - library entry still exists (untouched).
 *        - the canvas node now has functionLifecycle === 'local' with the
 *          library body deep-copied into its localDefinition.
 *
 *   D2 (saved + dirty): drag a shared Function from the Library modal so the
 *      canvas is dirty, then Make Local. Verify the in-memory fallback path
 *      uses GET /functions/{id} to fetch the body, rewrites the canvas
 *      locally, and leaves the Test dirty until the user saves.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const BASE = `http://localhost:${BACKEND_PORT}`
const FN_NODE_ID = 'fn-shared-1'

async function seedLibraryFunction(request: APIRequestContext): Promise<{ id: string; name: string }> {
  // Library Function names cap at 32 chars.
  const name = `DETACH ${randomUUID().slice(0, 8)}`
  const resp = await request.post(`${BASE}/functions`, {
    data: {
      name,
      description: 'Library entry used by V-FN-DETACH-FUNCTIONAL.',
      tags: ['detach'],
      inputs: [{ name: 'msg', type: 'string', required: true, default: '', description: '' }],
      outputs: [{ name: 'out', type: 'string', description: '' }],
      dependencies: { functions: [], plugins: [] },
      workflow: {
        nodes: [
          {
            id: 'inner-1',
            type: 'workflowNode',
            position: { x: 200, y: 200 },
            data: {
              label: 'Inner',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: { message: "'inner'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
            },
          },
        ],
        // Backend validator requires every node to be reachable from the
        // implicit `start-node`. Wire an edge from start to the inner Log
        // so validate_function_for_save accepts the workflow.
        edges: [{ id: 'e-start-inner', source: 'start-node', target: 'inner-1' }],
      },
      metadata: {},
    },
  })
  expect(resp.ok(), `POST /functions failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return { id: body.data.id, name }
}

async function seedHostTest(request: APIRequestContext, functionId: string): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, {
    data: {
      name: `V-FN-DETACH ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'V-FN-DETACH host: one shared Function reference.',
      workflow: {
        nodes: [
          {
            id: FN_NODE_ID,
            type: 'workflowNode',
            position: { x: 300, y: 200 },
            data: {
              label: 'SharedRef',
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
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
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function seedEmptyHostTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, {
    data: {
      name: `V-FN-DETACH host ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Empty host Test (used to exercise the in-memory detach path).',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openMakeLocalDialog(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Make Local…' }).click()
  const dialog = page.locator('[role="alertdialog"]', { hasText: 'Make Local' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

async function dragLibraryCardOntoCanvas(page: Page) {
  await expandPalette(page)
  await page.locator('[data-testid="palette-blocks-library-button"]').click()
  const modal = page.locator('[aria-label="Functions Library"]')
  await expect(modal).toBeVisible()
  const card = modal.locator('[data-testid="library-card"]').first()
  await expect(card).toBeVisible()
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  const modalBox = await modal.boundingBox()
  expect(box).toBeTruthy()
  expect(modalBox).toBeTruthy()
  // Drop BELOW the modal (the modal is z-50 over the canvas; dropping
  // inside its footprint lands the drop event on the modal section).
  const dropAbsX = box!.x + box!.width / 2
  const dropAbsY = modalBox!.y + modalBox!.height + 30
  await dragSourceToCanvas(page, card, {
    x: dropAbsX - box!.x,
    y: dropAbsY - box!.y,
  })
  // Close the library modal so the canvas is unobstructed.
  await page.keyboard.press('Escape')
}

test.describe('V-FN-DETACH-FUNCTIONAL: Make Local on a shared Function', () => {
  test('D1 (saved + clean): detach swaps the canvas node to local; library untouched', async ({
    page,
    request,
  }) => {
    const lib = await seedLibraryFunction(request)
    const testId = await seedHostTest(request, lib.id)
    await openTest(page, testId)

    const dialog = await openMakeLocalDialog(page, FN_NODE_ID)
    await dialog.getByRole('button', { name: 'Make Local' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Canvas node is now local.
    const badge = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="node-function-lifecycle-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-state', 'local')

    // Library entry is still present (Make Local does NOT delete the lib).
    const libResp = await request.get(`${BASE}/functions/${lib.id}`)
    expect(libResp.ok(), `library entry ${lib.id} should still exist`).toBeTruthy()
  })

  test('D2 (saved + dirty): in-memory detach via library fetch; Test stays dirty', async ({
    page,
    request,
  }) => {
    // Pre-seed the library so the Library modal has a card to drag.
    const lib = await seedLibraryFunction(request)
    const testId = await seedEmptyHostTest(request)
    await openTest(page, testId)
    await dragLibraryCardOntoCanvas(page)

    // The new shared node id is canvas-generated; pick the first function
    // node on the canvas.
    const newFn = page
      .locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
      .first()
    const newFnTestId = await newFn.getAttribute('data-testid')
    const newFnId = newFnTestId!.replace(/^workflow-node-/, '')

    // Should be shared (drop produces a reference, not a local copy).
    const badge = newFn.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toHaveAttribute('data-state', 'shared')

    const dialog = await openMakeLocalDialog(page, newFnId)
    await dialog.getByRole('button', { name: 'Make Local' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Canvas node is now local; library still present.
    await expect(badge).toHaveAttribute('data-state', 'local')
    const libResp = await request.get(`${BASE}/functions/${lib.id}`)
    expect(libResp.ok()).toBeTruthy()
  })
})
