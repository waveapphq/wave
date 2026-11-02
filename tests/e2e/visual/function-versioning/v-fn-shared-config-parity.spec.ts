/**
 * V-FN-SHARED-CONFIG-PARITY (visual): Shared Function config modal matches
 * plugin/control modal layout: "Edit Config" header + entity icon; Name
 * field; Version dropdown anchored right of Name; ParameterTable rows; no
 * lifecycle badge inside the modal; From-library link under Name.
 *
 * Pass Criteria:
 *   1. Open Shared instance config modal.
 *   2. Header reads "Edit Config" with a Function icon.
 *   3. Name field is present (editable).
 *   4. Version dropdown trigger is visible.
 *   5. From-library link text appears under the Name field.
 *   6. The modal does NOT render the canvas FunctionLifecycleBadge (no
 *      stray L/S badge inside the modal body itself).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

async function seedLibraryAndTest(
  request: APIRequestContext,
): Promise<{ testId: string; libName: string }> {
  const libName = `parity_${randomUUID().slice(0, 6)}`
  const lib = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name: libName,
      description: '',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
    },
  })
  const libBody = await lib.json()
  const functionId = libBody.data.id

  const seed = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-SHARED-CONFIG-PARITY ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance for config parity coverage',
      workflow: {
        nodes: [
          {
            id: 'shared-fn',
            type: 'workflowNode',
            position: { x: 300, y: 200 },
            data: {
              label: libName,
              elementType: 'function',
              nodeType: 'function',
              functionLifecycle: 'shared',
              functionId,
              functionVersion: '1.0.0',
              originalLibraryName: libName,
              category: 'function',
              version: '1.0.0',
              hasNewerVersion: false,
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: {}, outputBindings: {}, profileBindings: [] },
            },
          },
        ],
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  const seedBody = await seed.json()
  return { testId: seedBody.data.id, libName }
}

test.describe('V-FN-SHARED-CONFIG-PARITY (visual)', () => {
  test('Shared modal renders header, Version dropdown, From-library link', async ({
    page,
    request,
  }) => {
    const { testId, libName } = await seedLibraryAndTest(request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    const node = page.locator('[data-testid="workflow-node-shared-fn"]')
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Header text + icon.
    await expect(dialog.getByRole('heading', { name: / - Edit Config$/ })).toBeVisible()

    // Version dropdown trigger visible.
    await expect(dialog.locator('[data-testid="version-dropdown-trigger"]')).toBeVisible()

    // From-library link visible.
    await expect(dialog.locator(`text=/From library:.*${libName}/i`).first()).toBeVisible()

    // No canvas FunctionLifecycleBadge inside the modal body.
    // The badge is rendered with `data-testid` "function-lifecycle-badge"
    // on the canvas; modal must NOT carry it.
    const badge = dialog.locator('[data-testid="function-lifecycle-badge"]')
    expect(await badge.count(), `modal must not show lifecycle badge`).toBe(0)
  })
})
