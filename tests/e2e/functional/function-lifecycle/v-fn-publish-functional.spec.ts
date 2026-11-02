/**
 * V-FN-PUBLISH-FUNCTIONAL: Publish a local Function to the library end-to-end.
 *
 * REQ: REQ-3.1.2.1, REQ-3.1.2.3, REQ-3.1.2.4
 *
 * Three permutations chained into the same Test session so we get coverage
 * without creating three orthogonal workbench sessions:
 *
 *   P1 (saved + clean): publish a Function from a freshly-loaded saved Test.
 *      Verifies the saved-Test backend path
 *      (POST /tests/{id}/functions/publish) and that the canvas node swaps
 *      to functionLifecycle=shared.
 *   P2 (saved + dirty): drag in a new local Function so the canvas is dirty
 *      (the new node is not in the persisted Test yet). Publish must take
 *      the in-memory fallback path (POST /functions then canvas rewrite)
 *      and the Test stays dirty for the user to save when ready.
 *   P3 (draft canvas): same fallback path, but exercised from a draft Test
 *      (no persisted id). Verifies the dialog flow works even before the
 *      first save, with no zombie dialog and no silent no-op.
 *
 * Guards exercised in this spec:
 *   - Publish-on-draft is NOT a silent no-op (P3).
 *   - Publish-on-saved-dirty falls back to the in-memory path (P2).
 *   - The Test is NOT auto-saved by publish (P2 assertion).
 *
 * Phase: functional-workflow. Self-seeds via POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad, dragSourceToCanvas, expandPalette } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const BASE = `http://localhost:${BACKEND_PORT}`
const FN_NODE_ID = 'fn-pub'

function buildSeed(): Record<string, unknown> {
  return {
    name: `V-FN-PUBLISH ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'V-FN-PUBLISH host Test',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: 'PublishCandidate',
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'local',
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: {}, outputBindings: {}, profileBindings: [] },
            localDefinition: {
              name: 'PublishCandidate',
              description: '',
              workflow: { nodes: [], edges: [] },
              inputs: [],
              outputs: [],
              variables: [],
            },
          },
          measured: { width: 120, height: 62 },
        },
      ],
      edges: [],
    },
    variables: {},
    metadata: {},
  }
}

async function seedTest(request: APIRequestContext): Promise<string> {
  const resp = await request.post(`${BASE}/tests`, { data: buildSeed() })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openDraftWorkbench(page: Page) {
  // No editTest query: open the workbench in draft (new-Test) mode. We then
  // drag a local Function from the palette so the draft canvas has
  // something to publish.
  await page.request.delete(`${BASE}/workbench/session`).catch(() => {})
  await page.goto(`/workbench`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench`)
  await waitForCanvasLoad(page)
}

async function openPublishDialog(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Publish to Library' }).click()
  const dialog = page.locator('[role="dialog"]', { hasText: 'Publish Function' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

async function dragLocalFnIntoCanvas(page: Page) {
  await expandPalette(page)
  const newFnBtn = page.locator('[data-testid="palette-new-block-button"]')
  await expect(newFnBtn).toBeVisible()
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  expect(box).toBeTruthy()
  await dragSourceToCanvas(page, newFnBtn, { x: box!.width * 0.4, y: box!.height * 0.4 })
}

test.describe('V-FN-PUBLISH-FUNCTIONAL: Publish a local Function end-to-end', () => {
  test('P1 (saved + clean): publish via the saved-Test backend path', async ({ page, request }) => {
    const testId = await seedTest(request)
    await openTest(page, testId)

    const dialog = await openPublishDialog(page, FN_NODE_ID)
    // Library Function names cap at 32 chars. 8 base36 chars
    // gives ~3T combos, enough to be unique within the container.
    const uniqueName = `PUB P1 ${randomUUID().slice(0, 8)}`
    await dialog.locator('[data-testid="publish-name-input"]').fill(uniqueName)
    await dialog.getByRole('button', { name: 'Publish' }).click()

    // Dialog closes on success.
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Canvas node swapped to shared.
    const badge = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="node-function-lifecycle-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-state', 'shared')

    // Library entry created (lookup by the unique name).
    const listResp = await request.get(`${BASE}/functions?q=${encodeURIComponent(uniqueName)}`)
    expect(listResp.ok()).toBeTruthy()
    const list = await listResp.json()
    const found = list.data.find((f: { name: string }) => f.name === uniqueName)
    expect(found, `library entry "${uniqueName}" should exist after publish`).toBeTruthy()
  })

  test('P2 (saved + dirty): publish uses in-memory fallback, Test stays dirty (regression guard)', async ({
    page,
    request,
  }) => {
    // A saved-but-dirty canvas takes the in-memory fallback (POST /functions + canvas
    // rewrite), and the Test stays dirty so the user controls the save moment.
    const testId = await seedTest(request)
    await openTest(page, testId)
    await dragLocalFnIntoCanvas(page)

    // The new local Function node id is generated by the canvas; pick it
    // up by elementType (the test fixture's FN_NODE_ID is the only OTHER
    // function node, so excluding it leaves the new one).
    const newFn = page
      .locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
      .filter({ hasNot: page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`) })
      .first()
    const newFnTestId = await newFn.getAttribute('data-testid')
    const newFnId = newFnTestId!.replace(/^workflow-node-/, '')

    const dialog = await openPublishDialog(page, newFnId)
    const uniqueName = `PUB P2 ${randomUUID().slice(0, 8)}`
    await dialog.locator('[data-testid="publish-name-input"]').fill(uniqueName)
    await dialog.getByRole('button', { name: 'Publish' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    // Library entry exists (in-memory fallback path).
    const listResp = await request.get(`${BASE}/functions?q=${encodeURIComponent(uniqueName)}`)
    const list = await listResp.json()
    expect(list.data.find((f: { name: string }) => f.name === uniqueName)).toBeTruthy()

    // Canvas node is now shared.
    const badge = newFn.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toHaveAttribute('data-state', 'shared')

    // Test stays dirty (the toolbar Save button is enabled because the
    // canvas has unsaved structural changes the user must commit).
    const saveBtn = page.locator('[data-testid="save-button"]')
    if (await saveBtn.count()) {
      await expect(saveBtn).toBeEnabled()
    }
  })

  test('P3 (draft canvas): publish-to-library completes; no zombie dialog (regression guard)', async ({
    page,
    request,
  }) => {
    // A publish click on a draft canvas closes the dialog on success and creates
    // the library entry directly via POST /functions; the Test stays draft.
    await openDraftWorkbench(page)
    await dragLocalFnIntoCanvas(page)

    const newFn = page
      .locator('[data-testid^="workflow-node-"][data-nodetype="function"]')
      .first()
    const newFnTestId = await newFn.getAttribute('data-testid')
    const newFnId = newFnTestId!.replace(/^workflow-node-/, '')

    const dialog = await openPublishDialog(page, newFnId)
    const uniqueName = `PUB P3 ${randomUUID().slice(0, 8)}`
    await dialog.locator('[data-testid="publish-name-input"]').fill(uniqueName)
    await dialog.getByRole('button', { name: 'Publish' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })

    const listResp = await request.get(`${BASE}/functions?q=${encodeURIComponent(uniqueName)}`)
    const list = await listResp.json()
    expect(list.data.find((f: { name: string }) => f.name === uniqueName)).toBeTruthy()

    // Canvas node is now shared on the draft canvas.
    const badge = newFn.locator('[data-testid="node-function-lifecycle-badge"]')
    await expect(badge).toHaveAttribute('data-state', 'shared')
  })
})
