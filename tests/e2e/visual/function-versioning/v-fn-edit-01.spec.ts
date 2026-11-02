/**
 * V-FN-EDIT-01: Edit-mode entry from a Shared Function instance (FN-VER-1, FN-VER-2)
 *
 * Design Decisions:
 *   - FN-VER-1 (red SVG asterisk overlay on S badge top-right)
 *   - Edit / Publish / Drop changes live on the kebab; config modal stays plugin-equivalent
 *
 * Pass Criteria:
 *   1. Published Function kebab exposes an "Edit" action; clicking it flips
 *      the node into edit mode and the S badge gains the red asterisk overlay
 *      (visible via `[data-testid="edit-mode-mark-wrapper"]`).
 *   2. Hovering the asterisk surfaces a tooltip whose body names the source
 *      version (`v1.0.0`) and tells the user to use the kebab to Publish or
 *      Drop changes (FN-VER-2 wording).
 *   3. Opening the config modal in edit mode shows no Publish / Drop changes
 *      / Changelog / Details footer buttons (all lifecycle actions live
 *      on the kebab).
 *
 * Phase: no-data (the spec seeds its own Test + library entry via POST).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { clickNodeKebabItem, waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-edit-01'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibraryFunction(request: APIRequestContext): Promise<SeededFunction> {
  // Unique library name so concurrent shards do not collide on the
  // library-wide name-uniqueness check.
  const name = `EditFn ${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-EDIT-01 library entry (seeded for edit-mode coverage)',
      tags: [],
      inputs: [{ name: 'msg', type: 'string', required: true }],
      outputs: [{ name: 'out', type: 'string' }],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed library entry for V-FN-EDIT-01',
    },
  })
  expect(resp.ok(), `POST /functions failed: ${resp.status()} - ${await resp.text()}`).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

function buildSeedTest(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-EDIT-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'V-FN-EDIT-01 host Test with a Shared Function instance',
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
            config: { values: { msg: 'hello' }, outputBindings: {}, profileBindings: [] },
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

async function seedTest(request: APIRequestContext, fn: SeededFunction): Promise<string> {
  const resp = await request.post(`${BACKEND_URL}/tests`, { data: buildSeedTest(fn) })
  const body = await resp.json().catch(() => null)
  expect(body?.success === true, `POST /tests failed: ${resp.status()} - ${JSON.stringify(body)}`).toBeTruthy()
  return body.data.id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
}

test.describe('V-FN-EDIT-01: edit-mode entry on a Published Function instance', () => {
  test('S1: kebab Edit flips into edit mode and the asterisk overlay appears', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    // No asterisk before entering edit mode.
    const overlayBefore = page
      .locator(`[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`)
    await expect(overlayBefore).toHaveCount(0)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')

    // Overlay appears once the BE call resolves.
    const overlayAfter = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlayAfter).toBeVisible({ timeout: 10_000 })
  })

  test('S2: hover surfaces the tooltip naming the source version', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')

    const overlay = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    await overlay.hover()
    const tooltip = page.locator('[role="tooltip"]', {
      hasText: /Function in edit mode.*v1\.0\.0/,
    })
    await expect(tooltip.first()).toBeVisible({ timeout: 5_000 })
    await expect(tooltip.first()).toContainText('may differ from published')
  })

  test('S3: edit-mode config modal hides Publish / Drop / Changelog / Details footer buttons', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    await clickNodeKebabItem(page, FN_NODE_ID, 'Edit')

    // Wait for edit mode to be applied before opening the modal.
    const overlay = page.locator(
      `[data-testid="workflow-node-${FN_NODE_ID}"] [data-testid="edit-mode-mark-wrapper"]`,
    )
    await expect(overlay).toBeVisible({ timeout: 10_000 })

    // Open the config modal via the body button.
    await page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"] button`).first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Lifecycle action buttons MUST NOT appear in the modal's footer
    // when the instance is in edit mode (they live on the kebab).
    await expect(dialog.getByRole('button', { name: 'Publish' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Drop changes' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Changelog' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Details' })).toHaveCount(0)

    // Footer Cancel + Save are still present (matches plugin/control modal).
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeVisible()
  })
})
