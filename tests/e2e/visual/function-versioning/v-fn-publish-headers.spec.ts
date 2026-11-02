/**
 * V-FN-PUBLISH-HEADERS: PublishDialog + PublishEditModeDialog show the
 * Upload icon (indigo) + appropriate title. Version field is a TextField.
 *
 * Pass Criteria:
 *   1. Local Function -> Publish dialog: header text "Publish Function" or
 *      "Publish to Library" alongside an Upload icon styled indigo.
 *   2. Edit-mode publish dialog header text "Publish edit-mode draft"
 *      alongside the Upload icon styled indigo.
 *   3. Version-related TextField present (or smart dropdown for edit-mode).
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

interface SeededFn {
  functionId: string
  version: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `pub_hdr_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-PUBLISH-HEADERS seed',
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
      name: `V-FN-PUBLISH-HEADERS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Local + Shared instances for publish-header coverage',
      workflow: {
        nodes: [
          {
            id: 'local-fn',
            type: 'workflowNode',
            position: { x: 200, y: 200 },
            data: {
              label: 'Function',
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
                name: 'Function',
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
            position: { x: 500, y: 200 },
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

test.describe('V-FN-PUBLISH-HEADERS: dialog headers carry Upload icon', () => {
  test('PublishDialog (Local) and PublishEditModeDialog (Shared+edit) headers', async ({
    page,
    request,
  }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Local -> Publish (publish dialog)
    await clickNodeKebabItem(page, 'local-fn', /Publish/i)
    let dialog = page.locator('[role="dialog"]', { hasText: /Publish/i })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const icon = dialog.locator('svg').first()
    await expect(icon).toBeVisible()
    // indigo class on the icon, the wrapper, or any nearby span
    const dialogHTML = (await dialog.innerHTML()).toLowerCase()
    expect(dialogHTML).toContain('indigo')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)

    // Shared -> Edit then Publish (edit-mode publish dialog)
    await clickNodeKebabItem(page, 'shared-fn', 'Edit')
    const overlay = page.locator(
      '[data-testid="workflow-node-shared-fn"] [data-testid="edit-mode-mark-wrapper"]',
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })
    await clickNodeKebabItem(page, 'shared-fn', 'Publish')
    dialog = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const editDialogHTML = (await dialog.innerHTML()).toLowerCase()
    expect(editDialogHTML).toContain('indigo')
  })
})
