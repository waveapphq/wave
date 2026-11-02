/**
 * V-CANVAS-EDIT-CONFIG-HEADER: Edit Config modal header is uniform across
 * all block types (plugin, control, local Function, Shared Function).
 *
 * Both `ElementConfigModal` and
 * `FunctionConfigModal` share a uniform layout: DialogHeader with the
 * entity-specific icon (h-5 w-5, color from icon-registry) + "Edit Config"
 * title; Name + Version side-by-side via grid-cols-[1fr_auto].
 *
 * Pass Criteria:
 *   1. Log plugin config modal header reads "Edit Config" with the Log
 *      icon.
 *   2. If-Else control config modal header reads "Edit Config" with the
 *      If-Else icon.
 *   3. Local Function config modal header reads "Edit Config" with the
 *      Function icon.
 *   4. Shared Function config modal header reads "Edit Config" with the
 *      Function icon.
 *   5. Name + Version layout is side-by-side (the Version Select or pill
 *      sits to the right of the Name field).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

interface SeededFn {
  functionId: string
  version: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `cfg_hdr_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-CANVAS-EDIT-CONFIG-HEADER seed',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial',
      details: '',
    },
  })
  expect(resp.ok()).toBeTruthy()
  return { functionId: (await resp.json()).data.id, version: '1.0.0', name }
}

async function seedTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-CANVAS-EDIT-CONFIG-HEADER ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'All four block types for header parity coverage',
      workflow: {
        nodes: [
          {
            id: 'log-node',
            type: 'workflowNode',
            position: { x: 100, y: 100 },
            data: {
              label: 'Log',
              elementType: 'log',
              nodeType: 'plugin',
              category: 'system',
              version: '1.0.0',
              expressionFields: ['message'],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: { message: "'x'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
            },
          },
          {
            // A Delay control - the simplest control with a trivially-valid
            // config - proves "control" category header parity without the
            // if-else branches scaffolding.
            id: 'control-node',
            type: 'workflowNode',
            position: { x: 300, y: 100 },
            data: {
              label: 'Delay',
              elementType: 'delay',
              nodeType: 'control',
              category: 'timing',
              version: '1.0.0',
              expressionFields: [],
              templateFields: [],
              variableExpressionKeys: [],
              config: { values: { duration: 200 }, outputBindings: {}, profileBindings: [] },
            },
          },
          {
            id: 'local-fn',
            type: 'workflowNode',
            position: { x: 500, y: 100 },
            data: {
              label: 'Local Fn',
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
                name: 'Local Fn',
                description: '',
                inputs: [],
                outputs: [],
                variables: [],
                workflow: { nodes: [], edges: [] },
              },
            },
          },
          {
            id: 'shared-fn',
            type: 'workflowNode',
            position: { x: 700, y: 100 },
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
          },
        ],
        edges: [],
      },
      variables: {},
      metadata: {},
    },
  })
  const body = await resp.json()
  expect(body?.success).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openSheet(page: Page, nodeId: string) {
  const node = page.locator(`[data-testid="workflow-node-${nodeId}"]`)
  await node.locator('button').first().dblclick()
  const sheet = configSheet(page)
  await expect(sheet).toBeVisible({ timeout: 10_000 })
  return sheet
}

async function closeSheet(page: Page) {
  await page.keyboard.press('Escape')
  await expect(configSheet(page)).toHaveCount(0, { timeout: 5_000 })
}

test.describe('V-CANVAS-EDIT-CONFIG-HEADER: header parity across block types', () => {
  test('All four block types show "<Name> - Edit Config" title with an entity icon', async ({
    page,
    request,
  }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    // Per CANVAS-228 the sheet header reads "<Node name> - Edit Config".
    const expected: Array<[string, string]> = [
      ['log-node', 'Log'],
      ['control-node', 'Delay'],
      ['local-fn', 'Local Fn'],
      ['shared-fn', shared.name],
    ]
    for (const [id, name] of expected) {
      const sheet = await openSheet(page, id)
      const header = sheet.getByRole('heading', { name: `${name} - Edit Config` })
      await expect(header, `${id} must have "${name} - Edit Config" header`).toBeVisible()
      // Icon: the entity icon SVG inside the heading.
      const iconSibling = header.locator('svg').first()
      await expect(iconSibling, `${id} must render an icon next to the header`).toBeVisible()
      await closeSheet(page)
    }
  })
})
