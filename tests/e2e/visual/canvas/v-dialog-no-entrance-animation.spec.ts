/**
 * V-DIALOG-NO-ENTRANCE-ANIMATION: Dialog and AlertDialog content do NOT
 * carry the zoom-in / slide-in entrance animation classes, so popovers anchored
 * against the final input position do not jump.
 *
 * Pass Criteria:
 *   1. Open the Variable Setter config modal (a Dialog).
 *   2. The DialogContent root must NOT include `zoom-in`,
 *      `slide-in-from`, or `animate-in` in its class list.
 *   3. Open the MakeLocalDialog (an AlertDialog) - same check.
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
  const name = `noanim_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-DIALOG-NO-ENTRANCE-ANIMATION seed',
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
      name: `V-DIALOG-NO-ENTRANCE-ANIMATION ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'VarSetter + shared instance for dialog-animation coverage',
      workflow: {
        nodes: [
          {
            id: 'varset',
            type: 'workflowNode',
            position: { x: 200, y: 200 },
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
  return (await resp.json()).data.id
}

test.describe('V-DIALOG-NO-ENTRANCE-ANIMATION (visual)', () => {
  test('Dialog and AlertDialog do not carry the entrance-animation classes', async ({
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

    // Dialog (Details dialog opened from the Log config sheet - the config
    // shell itself is a DraggableSheet since CANVAS-228, not a Dialog).
    const logNode = page.locator('[data-testid="workflow-node-varset"]')
    await logNode.locator('button').first().dblclick()
    const sheet = page.locator('[data-testid="element-config-sheet"]')
    await expect(sheet).toBeVisible({ timeout: 10_000 })
    await sheet.getByRole('button', { name: 'Details' }).click()
    const dialog = page.locator('[role="dialog"]', { hasText: 'Documentation' })
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    const dialogClasses = (await dialog.getAttribute('class')) ?? ''
    expect(/zoom-in|slide-in-from|animate-in/.test(dialogClasses), `Dialog must not have entrance-animation classes; got "${dialogClasses}"`).toBe(false)
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden({ timeout: 5_000 })
    await page.keyboard.press('Escape')
    await expect(sheet).toHaveCount(0, { timeout: 5_000 })
    await page.waitForTimeout(200)

    // AlertDialog (Make Local).
    await clickNodeKebabItem(page, 'shared-fn', /Make Local/i)
    const alertDialog = page.locator('[role="alertdialog"]', { hasText: /Make Local/i })
    await expect(alertDialog).toBeVisible({ timeout: 5_000 })
    const alertClasses = (await alertDialog.getAttribute('class')) ?? ''
    expect(/zoom-in|slide-in-from|animate-in/.test(alertClasses), `AlertDialog must not have entrance-animation classes; got "${alertClasses}"`).toBe(false)
  })
})
