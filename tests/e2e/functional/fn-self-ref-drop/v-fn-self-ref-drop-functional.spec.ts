/**
 * V-FN-SELF-REF-DROP (functional): the composition-time drop guard rejects
 * nesting a Function inside itself.
 *
 * REQ: REQ-3.1.2.4 (Function validation before save).
 * The drop-guard half of the circular Function reference check; the walker
 * half lives in fn-composition-guards.
 *
 * While the user is drilled into a Function's
 * (editable) body, dropping the SAME library Function from the Library modal
 * must be rejected - no node is added and a toast explains why. The scenario is
 * driven on an edit-mode draft body (the editable case the guard is for); a
 * read-only published body rejects drops anyway.
 *
 * Phase: functional-workflow. Self-seeds via POST /functions + POST /tests.
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-self-ref-1'

interface SeededFn {
  functionId: string
  name: string
}

async function seedLibrary(request: APIRequestContext): Promise<SeededFn> {
  const name = `selfdrop_${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-SELF-REF-DROP seed (body has one Log so the draft drills in)',
      tags: [],
      inputs: [],
      outputs: [],
      workflow: {
        nodes: [
          {
            id: 'f-inner-log',
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
              config: { values: { message: "'inner'", level: 'INFO' }, outputBindings: {}, profileBindings: [] },
            },
          },
        ],
        edges: [{ id: 'e-start-inner', source: 'start-node', target: 'f-inner-log' }],
      },
      version: '1.0.0',
      changelog: 'Initial',
      details: 'seed',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return { functionId: (await resp.json()).data.id, name }
}

async function seedTest(request: APIRequestContext, shared: SeededFn): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, {
    data: {
      name: `V-FN-SELF-REF-DROP ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      version: '1.0.0',
      description: 'Shared instance of the self-drop seed',
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
              functionVersion: '1.0.0',
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

test.describe('V-FN-SELF-REF-DROP (functional): drop guard rejects self-nesting', () => {
  test('Dropping a Function into its own (edit-mode) body is rejected with a toast', async ({
    page,
    request,
  }) => {
    const shared = await seedLibrary(request)
    const testId = await seedTest(request, shared)
    await openTest(page, testId)

    // Enter edit mode so the body is editable (drops are accepted there).
    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')
    await expect(
      page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`),
    ).toBeVisible({ timeout: 10_000 })

    // Drill into the editable draft body (records this Function in the drill path).
    await page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="node-dig-in"]`).click()
    const breadcrumb = page.locator('[data-testid="canvas-breadcrumb"]')
    await expect(breadcrumb.locator('svg.lucide-square-function').first()).toBeVisible({ timeout: 10_000 })

    // Open the Functions Library and isolate THIS Function's card.
    await expandPalette(page)
    await page.locator('[data-testid="palette-blocks-library-button"]').click()
    const modal = page.locator('[aria-label="Functions Library"]')
    await expect(modal).toBeVisible()
    await modal.getByPlaceholder('Search Functions…').fill(shared.name)
    const card = modal
      .locator('[data-testid="library-card"]')
      .filter({ has: page.locator(`[data-testid="library-card-name"][aria-label="${shared.name}"]`) })
    await expect(card).toBeVisible({ timeout: 10_000 })

    // Drag the card onto the drilled body. The drop is rejected, so no node is
    // ever added - retry the synthetic DnD until the rejection toast appears
    // (a plain dragSourceToCanvas would wait for a +1 that never happens).
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    const modalBox = await modal.boundingBox()
    expect(canvasBox && modalBox).toBeTruthy()
    const target = {
      x: canvasBox!.width / 2,
      y: modalBox!.y + modalBox!.height + 30 - canvasBox!.y,
    }
    const rejectToast = page.locator('[data-toast]', { hasText: 'cannot be nested inside itself' })
    await expect(async () => {
      await card.dragTo(canvas, { targetPosition: target, force: true })
      await expect(rejectToast.first()).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 20_000 })

    // No Function node was added to the body (the Log is a plugin, not counted).
    await page.keyboard.press('Escape') // close the library modal
    await expect(
      page.locator('[data-testid^="workflow-node-"][data-nodetype="function"]'),
    ).toHaveCount(0)
  })
})
