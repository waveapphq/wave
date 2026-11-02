/**
 * V-FN-VER-REMEDIATE-01: missing-version remediation journey.
 * REQ: REQ-3.1.2.2.
 *
 * Guards two behaviors:
 *   - Live-clear: the config-modal missing-version state is computed LIVE
 *     from the selected vs fetched versions (not the stale load-time
 *     `element.missingVersion`), so picking an available version clears the
 *     banner + strikethrough + "Missing" chip immediately, before saving.
 *   - Save badge-clear: saving the modal after switching the version
 *     clears the canvas node's missing-version alert badge (the save handler
 *     re-resolves the contract).
 *
 * The instance is raw-persisted pinned to a version the library never had
 * (lib publishes 1.0.0, instance pins 2.0.0) - POST /tests would reject it.
 *
 * Pass Criteria:
 *   1. The canvas node shows the missing-version alert badge on load.
 *   2. Edit Config shows the 2.0.0 strikethrough + "Missing" chip + a
 *      destructive banner naming 2.0.0.
 *   3. Picking 1.0.0 in the dropdown clears the banner / chip / strikethrough
 *      WITHOUT saving (live-clear).
 *   4. Saving the modal clears the canvas node's missing-version badge.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { publishLibraryFunction, rawPersistTest, sharedNode, startEdge, openTest, dismissLoadDialogIfPresent } from '../../helpers/fn-seed'

const FN_NODE_ID = 'shared-1'
const MISSING_VERSION = '2.0.0'

test.describe('V-FN-VER-REMEDIATE-01: missing-version remediation', () => {
  test('picking an available version live-clears the modal; saving clears the node badge', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, { name: `Remediate ${Date.now()}` })
    const testId = await rawPersistTest(request, {
      name: 'V-FN-VER-REMEDIATE-01',
      nodes: [
        sharedNode(FN_NODE_ID, {
          functionId: fn.functionId,
          functionVersion: MISSING_VERSION,
          label: 'Greet',
          originalLibraryName: fn.name,
        }),
      ],
      edges: [startEdge(FN_NODE_ID)],
    })
    await openTest(page, testId)
    await dismissLoadDialogIfPresent(page)

    // 1. Canvas node carries the missing-version alert badge.
    const node = page.locator(`[data-testid="workflow-node-${FN_NODE_ID}"]`)
    await expect(node).toBeVisible()
    const badge = node.locator('[data-testid="node-validation-alert"]')
    await expect(badge).toBeVisible({ timeout: 10_000 })

    // 2. Edit Config surfaces the missing-version banner + strikethrough + chip.
    await node.locator('button').first().dblclick()
    const dialog = configSheet(page)
    await expect(dialog).toBeVisible({ timeout: 10_000 })

    const banner = dialog.locator('[data-testid="missing-version-banner"]')
    await expect(banner).toBeVisible()
    await expect(banner).toContainText(MISSING_VERSION)

    const trigger = dialog.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger.locator('.line-through')).toContainText(MISSING_VERSION)
    await expect(trigger).toContainText(/Missing/i)

    // 3. Pick the available version - banner / chip / strikethrough clear WITHOUT a save.
    await trigger.click()
    const menu = dialog.locator('[data-testid="version-dropdown-menu"]')
    await expect(menu).toBeVisible()
    await menu.getByRole('menuitemradio', { name: /1\.0\.0/ }).click()

    await expect(banner).toHaveCount(0)
    await expect(trigger.locator('.line-through')).toHaveCount(0)
    await expect(trigger).not.toContainText(/Missing/i)

    // 4. Save the modal - the canvas node's missing-version badge is gone.
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden({ timeout: 10_000 })
    await expect(node.locator('[data-testid="node-validation-alert"]')).toHaveCount(0, {
      timeout: 10_000,
    })
  })
})
