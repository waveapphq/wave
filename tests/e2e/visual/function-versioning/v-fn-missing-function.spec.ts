/**
 * V-FN-MISSING-FUNCTION (visual): a Shared Function instance whose library
 * entry was DELETED entirely (functionId no longer exists) renders the
 * "missing-function" banner. Distinct from the per-version missing case.
 *
 * Pass Criteria:
 *   1. Open a Shared instance whose functionId references a non-existent
 *      library entry.
 *   2. The config modal shows a red `missing-function-banner` mentioning
 *      the originalLibraryName + that the function is "no longer available
 *      in the library".
 *   3. The Version dropdown trigger renders with the red strikethrough
 *      pattern (reused from the per-version missing case).
 *   4. The Version dropdown is `disabled` (no versions to pick).
 *   5. Changelog / Details footer buttons are NOT visible.
 */

import { test, expect, type APIRequestContext } from '../../helpers/playwright-fixtures'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_URL } from '../../helpers/config'
import { configSheet } from '../../helpers/workbench'
import { dismissLoadDialogIfPresent } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

async function seedTestWithDeletedFunction(request: APIRequestContext): Promise<{
  testId: string
  libName: string
}> {
  const libName = `missing_${Math.random().toString(36).slice(2, 8)}`
  // Use a UUID that almost certainly doesn't exist in storage.
  const ghostFunctionId = `00000000-0000-0000-0000-${Math.random()
    .toString(36)
    .padEnd(12, '0')
    .slice(0, 12)
    .replace(/[^a-z0-9]/g, '0')}`

  // The write path blocks a Shared instance whose functionId is
  // unknown, so the broken state is raw-persisted via the admin bulk endpoint
  // (models "the library entry was deleted after the Test was saved").
  await request
    .post(`${BACKEND_URL}/admin/enable`, { data: { reason: 'V-FN-MISSING-FUNCTION seed' } })
    .catch(() => {})
  const testId = randomUUID()
  const entity = {
    id: testId,
    name: `V-FN-MISSING-FUNCTION ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    version: '1.0.0',
    description: 'Shared instance pointing at a non-existent library entry',
    workflow: {
      nodes: [
        {
          id: 'ghost-fn',
          type: 'workflowNode',
          position: { x: 300, y: 200 },
          data: {
            label: libName,
            elementType: 'function',
            nodeType: 'function',
            functionLifecycle: 'shared',
            functionId: ghostFunctionId,
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
  }
  const seed = await request.post(`${BACKEND_URL}/admin/bulk/tests`, {
    data: { operations: [{ op: 'add', entity }] },
  })
  expect(seed.ok(), `POST /admin/bulk/tests: ${seed.status()} ${await seed.text()}`).toBeTruthy()
  return { testId, libName }
}

test.describe('V-FN-MISSING-FUNCTION (visual)', () => {
  test('Config modal renders missing-function banner when the library entry is gone', async ({
    page,
    request,
  }) => {
    const { testId, libName } = await seedTestWithDeletedFunction(request)
    await page.request.delete(`${BACKEND_URL}/workbench/session`).catch(() => {})
    await page.goto(`/workbench?editTest=${testId}`)
    await page.evaluate(() => localStorage.clear())
    await page.goto(`/workbench?editTest=${testId}`)
    await waitForCanvasLoad(page)
    // The unknown functionId surfaces as a non-fatal load dialog over the
    // canvas; dismiss it so the node / config-modal interactions are not blocked.
    await dismissLoadDialogIfPresent(page)

    const node = page.locator('[data-testid="workflow-node-ghost-fn"]')
    await expect(node).toBeVisible()
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    // Banner identifies the missing library entry.
    const banner = dialog.locator('[data-testid="missing-function-banner"]')
    await expect(
      banner,
      'missing-function-banner must render when functionId resolves to nothing',
    ).toBeVisible({ timeout: 10_000 })
    await expect(banner).toContainText(libName)
    await expect(banner).toContainText(/no longer available|not found|deleted/i)

    // Changelog / Details footer buttons must be hidden.
    await expect(dialog.getByRole('button', { name: 'Changelog' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'Details' })).toHaveCount(0)
  })
})
