/**
 * V-FN-PALETTE-FUNCTIONAL: "+ New Local Function" drag end-to-end
 *
 * Design Decisions: "New Function" drag, local Function node data shape,
 *                   CANVAS-201.
 * REQ: REQ-3.1.1.8, REQ-3.1.2.1 (partial - local Function creation only).
 *
 * Pass Criteria:
 *   1. Dragging the "+ New Local Function" handle onto the canvas materializes a
 *      node with `nodeType: 'function'`, `functionLifecycle: 'local'`,
 *      `label: 'Function_1'`, `elementType: 'function'`, and a `localDefinition`
 *      carrying an empty workflow + empty input/output arrays.
 *   2. After saving, POST `/tests/{id}/validate` returns 200 (zero errors) - the
 *      new Function node passes server-side validation as a structural addition
 *      to the workflow.
 *   3. GET `/tests/{id}/workflow` returns the persisted Function node with the
 *      full data shape from item 1.
 *
 * Out of scope (covered by other specs):
 *   - Dragging a published Function card from the Functions Library modal.
 *   - Workflow execution of Function nodes.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { dragSourceToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'
import fs from 'fs'
import path from 'path'

const BASE = `http://localhost:${BACKEND_PORT}`

function loadFixture(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.resolve(__dirname, 'fixture.json'), 'utf-8'))
}

async function importEmptyTest(request: APIRequestContext): Promise<string> {
  const fixture = loadFixture()
  const resp = await request.post(`${BASE}/tests`, {
    data: { ...fixture, name: `V-FN-PALETTE-FUNCTIONAL ${Date.now()}` },
  })
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as { data?: { id?: string } }
  return body.data!.id!
}

async function fetchWorkflow(
  request: APIRequestContext,
  testId: string,
): Promise<{ nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }> {
  const resp = await request.get(`${BASE}/tests/${testId}/workflow`)
  expect(resp.ok(), `GET /tests/${testId}/workflow failed: ${resp.status()}`).toBeTruthy()
  const body = (await resp.json()) as { data?: { nodes?: unknown; edges?: unknown } }
  const data = body.data ?? {}
  return {
    nodes: (data.nodes as Array<Record<string, unknown>>) ?? [],
    edges: (data.edges as Array<Record<string, unknown>>) ?? [],
  }
}

async function assertValidationClean(
  request: APIRequestContext,
  testId: string,
): Promise<void> {
  const resp = await request.post(`${BASE}/tests/${testId}/validate?context=load`)
  const text = await resp.text()
  expect(
    resp.ok(),
    `POST /tests/${testId}/validate expected 200 (zero errors); got ${resp.status()}\n${text}`,
  ).toBeTruthy()
}

async function clickSaveAndWaitForClean(page: Page): Promise<void> {
  const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
  await expect(saveBtn).toBeVisible()
  await expect(saveBtn).toBeEnabled({ timeout: 10_000 })
  await saveBtn.click()
  // Save completes when isDirty -> false, which re-disables the button.
  await expect(saveBtn).toBeDisabled({ timeout: 10_000 })
}

test.describe('V-FN-PALETTE-FUNCTIONAL: drag "+" -> local Function node', () => {
  test('drag + materializes a local Function node; validation passes after save', async ({
    page,
    request,
  }) => {
    await page.request.delete(`${BASE}/workbench/session`).catch(() => {})

    // ------------------------------------------------------------------
    // STEP 1: Import empty test, open in the workbench
    // ------------------------------------------------------------------
    const testId = await importEmptyTest(request)
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // The Save button is disabled when the test is clean (post-load).
    const saveBtn = page.locator('[data-testid="toolbar-save-button"]')
    await expect(saveBtn).toBeDisabled()

    // ------------------------------------------------------------------
    // STEP 2: Drag "+ New Local Function" onto the canvas
    // ------------------------------------------------------------------
    const palette = page.locator('[data-testid="block-palette"]')
    if ((await palette.getAttribute('data-state')) === 'collapsed') {
      await page.locator('[data-testid="palette-expand-button"]').click()
      await expect(palette).toHaveAttribute('data-state', 'expanded')
    }

    const newFunctionBtn = page.locator('[data-testid="palette-new-block-button"]')
    await expect(newFunctionBtn).toBeVisible()
    await expect(newFunctionBtn).toHaveAttribute('draggable', 'true')

    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    expect(canvasBox).toBeTruthy()

    await dragSourceToCanvas(page, newFunctionBtn, {
      x: canvasBox!.width * 0.5,
      y: canvasBox!.height * 0.5,
    })

    await expect(
      page.locator('[data-testid^="workflow-node-"]').getByText('Function', { exact: true }),
    ).toBeVisible()

    // ------------------------------------------------------------------
    // STEP 3: Save + verify node persists with the expected shape
    // ------------------------------------------------------------------
    await clickSaveAndWaitForClean(page)

    const { nodes } = await fetchWorkflow(request, testId)
    const fnNodes = nodes.filter((n) => {
      const data = (n.data ?? {}) as Record<string, unknown>
      return data.nodeType === 'function'
    })
    expect(fnNodes, 'one Function node after save').toHaveLength(1)

    const data = (fnNodes[0].data ?? {}) as Record<string, unknown>
    expect(data.nodeType, 'data.nodeType').toBe('function')
    expect(data.functionLifecycle, 'data.functionLifecycle').toBe('local')
    expect(data.elementType, 'data.elementType').toBe('function')
    expect(data.label, 'data.label').toBe('Function')

    const local = (data.localDefinition ?? {}) as Record<string, unknown>
    const wf = (local.workflow ?? {}) as Record<string, unknown>
    expect(wf.nodes, 'localDefinition.workflow.nodes is an array').toBeInstanceOf(Array)
    expect(wf.edges, 'localDefinition.workflow.edges is an array').toBeInstanceOf(Array)
    expect(local.inputs, 'localDefinition.inputs is an array').toBeInstanceOf(Array)
    expect(local.outputs, 'localDefinition.outputs is an array').toBeInstanceOf(Array)

    // ------------------------------------------------------------------
    // STEP 4: Server-side validation reports zero errors
    // ------------------------------------------------------------------
    await assertValidationClean(request, testId)
  })
})
