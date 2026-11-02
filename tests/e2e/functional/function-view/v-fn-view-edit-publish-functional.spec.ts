/**
 * V-FN-VIEW-EDIT-PUBLISH (functional): edit-in-View publish keeps added inputs.
 *
 * A publish while drilled in folds `localDefinition` (the live edits) into the draft
 * before the bump check, so an added input is kept and a PATCH is not allowed.
 *
 * REQ: REQ-3.1.2.2
 *
 * Pass Criteria:
 *   1. After adding an input, the suggested bump is NOT a patch (an added input
 *      forces minor/major - publishing a patch is gated).
 *   2. The published version's inputs INCLUDE the added one.
 *
 * Phase: functional-workflow. Self-seeds a published Function via REST.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction, openFunctionView, logNode, startEdge } from '../../helpers/fn-seed'
import { BACKEND_URL } from '../../helpers/config'
import { randomUUID } from 'node:crypto'

test.describe('V-FN-VIEW-EDIT-PUBLISH (functional): the fold guard', () => {
  test('adding an input forces a non-patch bump and the published version keeps it', async ({
    page,
    request,
  }) => {
    const fn = await publishLibraryFunction(request, {
      name: `View-Fold-${randomUUID().slice(0, 6)}`,
      inputs: [{ name: 'x', type: 'string', required: false, default: 'hi' }],
      workflow: { nodes: [logNode('inner-log', 'Body', 'x')], edges: [startEdge('inner-log')] },
    })
    await openFunctionView(page, fn.functionId, fn.version)

    // Enter edit mode and add a new input via the Var Manager.
    await page.locator('[data-testid="action-bar-edit-function-button"]').click()
    await expect(page.locator('[data-testid="action-bar-publish-button"]')).toBeVisible({ timeout: 15_000 })
    const varPanel = page.locator('[data-testid="variable-manager"]')
    if ((await varPanel.getAttribute('data-state')) === 'collapsed') {
      await page.locator('[aria-label="Expand Variable Manager"]').first().click()
    }
    await page.locator('[data-testid="add-variable-dropdown-trigger"]').click()
    await page.getByText('Input parameter', { exact: false }).first().click()
    // Param declaration is absorbed into the create modal (input mode).
    const scalarDialog = page.locator('[data-testid="variable-create-modal"]')
    await expect(scalarDialog).toBeVisible({ timeout: 8_000 })
    await scalarDialog.locator('[data-testid="create-variable-name"]').fill('newinput')
    await scalarDialog.locator('[data-testid="create-submit-button"]').click()
    await expect(scalarDialog).toBeHidden({ timeout: 8_000 })

    // Publish: the suggested target must NOT be a patch now that an input was
    // added (the bump gate forces minor/major).
    await page.locator('[data-testid="action-bar-publish-button"]').click()
    const meta = page.locator('[role="dialog"]', { hasText: 'Publish edit-mode draft' })
    await expect(meta).toBeVisible({ timeout: 10_000 })
    const trigger = meta.locator('[data-testid="version-dropdown-trigger"]')
    await expect(trigger).not.toContainText('1.0.1')
    await expect(trigger).toContainText(/1\.1\.0|2\.0\.0/)

    await meta.locator('[data-testid="publish-edit-mode-changelog-input"]').fill('added newinput')
    await meta.locator('[data-testid="publish-edit-mode-details-input"]').fill('fold guard')
    await meta.getByRole('button', { name: 'Publish' }).click()
    const confirm = page.locator('[data-testid="publish-outcome-single-confirm"]')
    await expect(confirm).toBeVisible({ timeout: 8_000 })
    await confirm.click()
    await expect(confirm).toBeHidden({ timeout: 15_000 })

    // The published version INCLUDES the added input (the fold worked).
    const vResp = await request.get(`${BACKEND_URL}/functions/${fn.functionId}/versions`)
    const versions = (await vResp.json()).data.versions as Array<{ version: string; inputs?: Array<{ name: string }> }>
    const newest = versions.find((v) => v.version !== '1.0.0')
    expect(newest, 'a new version was published').toBeTruthy()
    const inputNames = (newest!.inputs ?? []).map((i) => i.name)
    expect(inputNames).toContain('newinput')
  })
})
