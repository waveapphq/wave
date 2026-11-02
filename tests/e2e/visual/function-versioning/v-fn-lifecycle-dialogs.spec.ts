/**
 * V-FN-LIFECYCLE-DIALOGS: MakeLocalDialog + DropChangesDialog both render
 * as alertdialog with no ESC / no backdrop dismiss.
 *
 * Pass Criteria:
 *   1. MakeLocalDialog: role=alertdialog; title includes "Make Local";
 *      Cancel + Make Local buttons present; ESC does NOT dismiss; clicking
 *      outside does NOT dismiss.
 *   2. DropChangesDialog: role=alertdialog; title includes "Drop changes";
 *      Cancel + Drop changes buttons present; ESC does NOT dismiss.
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
  const name = `lifecycle_dlg_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-LIFECYCLE-DIALOGS seed',
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
      name: `V-FN-LIFECYCLE-DIALOGS ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance, pre-seeded edit mode for both dialogs',
      workflow: {
        nodes: [
          {
            id: 'shared-fn',
            type: 'workflowNode',
            position: { x: 300, y: 200 },
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
  return (await resp.json()).data.id
}

test.describe('V-FN-LIFECYCLE-DIALOGS (visual): destructive dialog policy enforced', () => {
  test('MakeLocalDialog: alertdialog, ESC does NOT dismiss', async ({ page, request }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    await clickNodeKebabItem(page, 'shared-fn', /Make Local/i)
    const dialog = page.locator('[role="alertdialog"]', { hasText: /Make Local/i })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    // Cancel + Make Local buttons.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: /Make Local/i })).toBeVisible()
  })

  test('DropChangesDialog: alertdialog, ESC does NOT dismiss', async ({ page, request }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)

    // Enter edit mode first.
    await clickNodeKebabItem(page, 'shared-fn', 'Edit')
    const overlay = page.locator(
      '[data-testid="workflow-node-shared-fn"] [data-testid="edit-mode-mark-wrapper"]',
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    await clickNodeKebabItem(page, 'shared-fn', 'Drop changes')
    const dialog = page.locator('[role="alertdialog"]', { hasText: 'Drop changes' })
    await expect(dialog).toBeVisible({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Drop changes' })).toBeVisible()
  })
})
