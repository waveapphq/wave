/**
 * V-FROM-LIBRARY-LINK (functional): the "From library: <name>" link on a
 * Shared Function instance's config modal opens the Functions Library
 * modal.
 *
 * Guards `setFunctionLibraryOpen(open, seed?)`
 * plumbing in workflow-store and the call from FunctionConfigModal.
 *
 * Pass Criteria:
 *   1. Open the Shared instance config sheet.
 *   2. Click the "From library: <name>" inline link.
 *   3. The config sheet STAYS OPEN (CANVAS-230: sheets are non-blocking;
 *      the link opens or focuses the library side by side).
 *   4. The Functions Library sheet becomes visible.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-from-library-1'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFunction> {
  const name = `from_library_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FROM-LIBRARY-LINK seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed',
    },
  })
  expect(resp.ok()).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

async function seedTest(request: APIRequestContext, fn: SeededFunction): Promise<string> {
  const seed = {
    name: `V-FROM-LIBRARY-LINK ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Shared Function instance for From-library link coverage',
    workflow: {
      nodes: [
        {
          id: FN_NODE_ID,
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: fn.name,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: fn.functionId,
            functionVersion: fn.version,
            originalLibraryName: fn.name,
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
      edges: [{ id: 'e-start-fn', source: 'start-node', target: FN_NODE_ID }],
    },
    variables: {},
    metadata: {},
  }
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: seed })
  const body = await resp.json()
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

test.describe('V-FROM-LIBRARY-LINK (functional)', () => {
  test('Clicking "From library" opens the Functions Library modal', async ({
    page,
    request,
  }) => {
    const fn = await seedLibrary(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    // Open config modal on the Shared instance.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Click the From-library link.
    const link = dialog.locator(`text=/From library:.*${fn.name}/i`).first()
    await expect(link).toBeVisible({ timeout: 5_000 })
    await link.click()

    // Library modal becomes visible. Its drag handle is the signature element.
    const libraryHandle = page.locator('[data-testid="functions-library-drag-handle"]')
    await expect(libraryHandle).toBeVisible({ timeout: 10_000 })

    // CANVAS-230: the config sheet does NOT close - both stay open.
    await expect(dialog).toBeVisible()
  })
})
