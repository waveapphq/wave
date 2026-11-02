/**
 * V-FN-VER-AVAIL-01: Missing-version visuals on canvas and in the config modal
 * (FN-VER-9, FN-VER-10, FN-VER-11).
 *
 * Design Decisions:
 *   - FN-VER-10 (red triangle validation alert in the canvas-node status bar)
 *   - FN-VER-11 (destructive banner + red-bordered dropdown trigger with strikethrough
 *     + "Missing" chip; Make Local entry disabled)
 *
 * Pass Criteria:
 *   1. Canvas node renders the missing-version validation alert badge before
 *      the S badge.
 *   2. Hovering the alert surfaces a tooltip that names the missing version
 *      and points to the config modal.
 *   3. The config modal opens with the destructive `missing-version-banner`
 *      (role=alert) that names the missing version.
 *   4. The version dropdown trigger renders the pinned version with
 *      strikethrough + a destructive "Missing" chip.
 *   5. The dropdown lists ONLY the available versions (the missing pinned one
 *      is not offered).
 *   6. The kebab "Make Local" entry is disabled (FN-VER-11 - no source body to copy).
 *
 * Phase: fixture (seeds a Test referencing a missing library version).
 */

import { test, expect, type Page, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { dismissLoadDialogIfPresent } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

const FN_NODE_ID = 'fn-missing-ver'
const MISSING_VERSION = '9.9.9'

interface SeededFunction {
  functionId: string
  version: string
  name: string
}

async function seedLibraryFunction(request: APIRequestContext): Promise<SeededFunction> {
  const name = `MissingVer ${randomUUID().slice(0, 6)}`
  const resp = await request.post(`${BACKEND_URL}/functions`, {
    data: {
      name,
      description: 'V-FN-VER-AVAIL-01 library entry (only 1.0.0 exists; pinned 9.9.9 is missing)',
      tags: [],
      inputs: [{ name: 'msg', type: 'string', required: true }],
      outputs: [{ name: 'out', type: 'string' }],
      workflow: { nodes: [], edges: [] },
      version: '1.0.0',
      changelog: 'Initial release',
      details: 'Seed library entry; the Test will pin a missing version',
    },
  })
  expect(resp.ok(), `POST /functions: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return { functionId: body.data.id, version: '1.0.0', name }
}

function buildSeedTest(fn: SeededFunction): Record<string, unknown> {
  return {
    name: `V-FN-VER-AVAIL-01 ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'V-FN-VER-AVAIL-01 host Test (pins a missing version)',
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
            // Pin to a version that does NOT exist in the library; the FE
            // resolves the missing-version state.
            functionVersion: MISSING_VERSION,
            originalLibraryName: fn.name,
            category: 'function',
            version: '1.0.0',
            hasNewerVersion: false,
            expressionFields: [],
            templateFields: [],
            variableExpressionKeys: [],
            config: { values: { msg: 'hi' }, outputBindings: {}, profileBindings: [] },
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

// The write path blocks a Test pinned to a missing version, so the
// broken state is raw-persisted via the admin bulk endpoint (models "the
// library version was deleted after the Test was saved").
async function seedTest(request: APIRequestContext, fn: SeededFunction): Promise<string> {
  await request
    .post(`${BACKEND_URL}/admin/enable`, { data: { reason: 'V-FN-VER-AVAIL-01 missing-version seed' } })
    .catch(() => {})
  const id = randomUUID()
  const resp = await request.post(`${BACKEND_URL}/admin/bulk/tests`, {
    data: { operations: [{ op: 'add', entity: { id, ...buildSeedTest(fn) } }] },
  })
  expect(resp.ok(), `POST /admin/bulk/tests: ${resp.status()} ${await resp.text()}`).toBeTruthy()
  return id
}

async function openTest(page: Page, testId: string) {
  await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
  await page.goto(`/workbench?editTest=${testId}`)
  await page.evaluate(() => localStorage.clear())
  await page.goto(`/workbench?editTest=${testId}`)
  await waitForCanvasLoad(page)
  // The missing pin surfaces as a non-fatal load dialog over the canvas;
  // dismiss it so the node / config-modal interactions are not blocked.
  await dismissLoadDialogIfPresent(page)
}

async function openConfigModal(page: Page) {
  await page
    .locator(`[data-testid="workflow-node-${FN_NODE_ID}"] button`)
    .first()
    .dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-FN-VER-AVAIL-01: missing-version visuals', () => {
  test('S1: canvas alert + tooltip name the missing version', async ({ page, request }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(node).toBeVisible()

    // Validation alert badge surfaces alongside the S badge.
    const alert = node.locator('[data-testid="node-validation-alert"]')
    await expect(alert).toBeVisible()

    // Tooltip names the missing version + recovery path.
    await alert.hover()
    const tooltip = page.locator('[role="tooltip"]', {
      hasText: new RegExp(MISSING_VERSION.replace(/\./g, '\\.')),
    })
    await expect(tooltip.first()).toBeVisible({ timeout: 5_000 })
  })

  test('S2: config modal renders banner + red dropdown trigger + Missing chip', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    const dialog = await openConfigModal(page)

    const banner = dialog.locator('[data-testid="missing-version-banner"]')
    await expect(banner).toBeVisible()
    await expect(banner).toHaveAttribute('role', 'alert')
    await expect(banner).toContainText(MISSING_VERSION)

    const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger).toBeVisible()
    // Pinned version text is rendered with strikethrough.
    await expect(trigger.locator('.line-through')).toContainText(MISSING_VERSION)
    // Destructive "Missing" chip is next to it.
    await expect(trigger).toContainText(/Missing/i)
  })

  test('S3: dropdown lists available versions only; missing one is not offered', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)
    const dialog = await openConfigModal(page)

    await dialog.locator('[data-testid="version-dropdown-trigger"]').click()
    const menu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(menu).toBeVisible()

    // The only available version (1.0.0) is listed; the missing pinned 9.9.9 is NOT.
    await expect(menu.getByRole('menuitemradio').filter({ hasText: 'v1.0.0' })).toBeVisible()
    await expect(menu.getByRole('menuitemradio').filter({ hasText: `v${MISSING_VERSION}` })).toHaveCount(0)
  })

  test('S4: kebab Make Local is disabled (no source body to copy)', async ({
    page,
    request,
  }) => {
    const fn = await seedLibraryFunction(request)
    const testId = await seedTest(request, fn)
    await openTest(page, testId)

    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await node.locator('button').first().dispatchEvent('click')
    await node.locator('[data-testid="node-kebab"]').click()
    const menu = page.locator('[role="menu"]')
    await expect(menu).toBeVisible()

    const makeLocal = menu.getByRole('menuitem', { name: /Make Local/i })
    await expect(makeLocal).toBeVisible()
    // Radix encodes disabled menu items with data-disabled attribute.
    await expect(makeLocal).toHaveAttribute('data-disabled', '')
  })
})
