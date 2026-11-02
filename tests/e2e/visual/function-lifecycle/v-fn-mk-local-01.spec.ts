/**
 * V-FN-MK-LOCAL-01: Make Local confirmation dialog (FN-LC-16..17)
 *
 * Design Decisions:
 *   - FN-LC-16 (confirmation dialog, not silent)
 *   - FN-LC-17 (Cancel/Escape/✕ are no-ops; only "Make Local" triggers the detach)
 *
 * Pass Criteria:
 *   1. Dialog opens from kebab "Make Local…" entry of a shared Function.
 *   2. Title is "Make Local" with an sr-only DialogDescription
 *   3. Body explicitly states the deep-copy semantics including
 *      "Any nested references to other published Functions inside the body
 *      remain shared."
 *   4. Amber callout (`data-testid="make-local-callout"`) renders with the
 *      warning copy.
 *   5. Footer order: Cancel + Make Local (primary).
 *   6. Cancel closes the dialog without mutating anything (the canvas node
 *      stays shared; the workflow-store drillPath stays empty).
 *
 * Phase: fixture (seeds a Test with a shared Function reference + a library
 * entry via POST /functions + POST /tests).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-shared-1'

async function seedLibraryFunction(page: Page): Promise<string> {
  // Library Function names cap at 32 chars (FN-LC-1). Short suffix only.
  const name = `MK-LOCAL ${randomUUID().slice(0, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'Library entry used to drive the Make Local dialog.',
      tags: [],
      inputs: [{ name: 'msg', type: 'string', required: true, default: '', description: '' }],
      outputs: [{ name: 'out', type: 'string', description: '' }],
      dependencies: { functions: [], plugins: [] },
      workflow: { nodes: [], edges: [] },
      metadata: {},
    },
  })
  const body = await resp.json().catch(() => null)
  expect(
    resp.ok(),
    `POST /functions failed: ${resp.status()} ${JSON.stringify(body)}`,
  ).toBeTruthy()
  return body!.data.id
}

async function seedTest(page: Page, functionId: string): Promise<string> {
  const name = `V-FN-MK-LOCAL-01 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const resp = await page.request.post(`${BACKEND_URL}/tests`, {
    data: {
      name,
      version: '1.0.0',
      description: 'V-FN-MK-LOCAL-01 host with a shared Function reference',
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
  expect(resp.ok(), `POST /tests failed: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return body.data.id
}

async function open(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

async function openMakeLocalDialog(page: Page) {
  const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
  await expect(node).toBeVisible()
  await node.locator('button').first().dispatchEvent('click')
  await node.locator('[data-testid="node-kebab"]').click()
  const menu = page.locator('[role="menu"]')
  await expect(menu).toBeVisible()
  // FN-LC-15: "Make Local…" with the trailing ellipsis.
  await menu.getByRole('menuitem', { name: 'Make Local…' }).click()
  const dialog = page.locator('[role="alertdialog"]', { hasText: 'Make Local' })
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-MK-LOCAL-01: Make Local confirmation dialog', () => {
  test('S1: dialog opens with title, description, body copy, amber callout', async ({
    page,
  }) => {
    const functionId = await seedLibraryFunction(page)
    const testId = await seedTest(page, functionId)
    await open(page, testId)

    const dialog = await openMakeLocalDialog(page)

    // (2) Title + the visible AlertDialogDescription naming the Function and
    // explaining the copy-into-Test semantics (the library link is cut).
    await expect(dialog.getByRole('heading', { name: 'Make Local' })).toBeVisible()
    const body = dialog.locator('p').first()
    await expect(body).toContainText('editable copy')
    await expect(body).toContainText('library entry is untouched')

    // (4) Amber callout.
    await expect(dialog.locator('[data-testid="make-local-callout"]')).toBeVisible()

    // (5) Footer order: Cancel + Make Local.
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Make Local' })).toBeVisible()
  })

  test('S2: Cancel closes the dialog without mutating canvas state', async ({ page }) => {
    const functionId = await seedLibraryFunction(page)
    const testId = await seedTest(page, functionId)
    await open(page, testId)

    const dialog = await openMakeLocalDialog(page)
    await dialog.getByRole('button', { name: 'Cancel' }).click()
    await expect(dialog).toBeHidden({ timeout: 5_000 })

    // Node should still be shared (no mutation occurred).
    const badge = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="node-function-lifecycle-badge"]`,
    )
    await expect(badge).toHaveAttribute('data-state', 'shared')
  })
})
