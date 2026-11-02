/**
 * V-VALIDATE-ICON-01: Persistent alert icon + live edit clears + inline gate
 *
 * Phase: no-data (parallel) - palette drag + config modal only, no entity fixtures
 * Design Decisions: alert icon, live FE validation, output-binding inline gate
 *
 * Pass Criteria:
 * 1. Dragging an HTTP node onto a fresh canvas surfaces the persistent
 *    alert icon for the required `url` parameter (REQUIRED_PARAM_MISSING).
 *    No pulse is applied (the user has not triggered Save / Run / Debug).
 * 2. Editing the node and supplying the required parameter via the
 *    config modal clears `nodeIssues` for that node (live recompute);
 *    the alert icon disappears as soon as the config modal closes.
 * 3. Output binding inline gate: in the HTTP config modal, binding the
 *    string-typed `body` output to an integer variable surfaces the
 *    inline type-mismatch error under the row and disables the modal
 *    Save button. Clearing the binding re-enables Save.
 *
 * Save / Run / Debug pre-validation modal flow (with pulse on close) is
 * covered separately by v-validate-load-01 (S13, S17, S18) where a saved
 * test with editingTestId fires the unified modal on the toolbar buttons.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet } from '../../helpers/workbench'
import { setStringParam } from '../../helpers/param-config'

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

const SEL = {
  canvas: '[data-testid="workflow-canvas"]',
  alertIcon: '[data-testid="node-validation-alert"]',
  paletteSearch: '[data-testid="palette-search-input"]',
  variableManager: '[data-testid="variable-manager"]',
  variableManagerContent: '[data-testid="variable-manager-content"]',
  addVariableBtn: '[data-testid="add-variable-button"]',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearWorkbenchState(page: Page) {
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

async function dragHttpToCanvas(page: Page) {
  await expandPalette(page)
  const searchInput = page.locator(SEL.paletteSearch)
  await searchInput.fill('http')
  await page.waitForTimeout(100)
  const canvas = page.locator(SEL.canvas)
  const canvasBox = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, 'http', {
    x: canvasBox!.width / 2,
    y: canvasBox!.height / 2,
  })
  await page.waitForTimeout(200)
}

async function getFirstWorkflowNode(page: Page) {
  return page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
}

async function openConfigForFirstNode(page: Page): Promise<Locator> {
  const node = await getFirstWorkflowNode(page)
  await node.scrollIntoViewIfNeeded()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  const gear = page.locator('[data-testid="node-configure"]').first()
  await gear.click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function expandVariableManager(page: Page) {
  // Variable Manager panel is collapsed by default; click the
  // "Expand Variable Manager" button on its right-side toggle.
  const panel = page.locator(SEL.variableManager)
  await expect(panel).toBeVisible()
  const state = await panel.getAttribute('data-state')
  if (state === 'expanded') return
  await page.getByRole('button', { name: 'Expand Variable Manager' }).first().click()
  await expect(panel).toHaveAttribute('data-state', 'expanded')
  await expect(page.locator(SEL.variableManagerContent)).toBeVisible()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('V-VALIDATE-ICON-01: Persistent alert icon + pulse', () => {
  test.beforeEach(async ({ page }) => {
    await clearWorkbenchState(page)
  })

  test('S1: dragging an HTTP plugin surfaces the persistent alert icon', async ({ page }) => {
    await dragHttpToCanvas(page)

    // The HTTP node has REQUIRED_PARAM_MISSING for url + method, so the
    // live FE validator (computeNodeIssues) populates nodeIssues for it
    // and the persistent alert badge is rendered immediately.
    const node = await getFirstWorkflowNode(page)
    const alert = node.locator(SEL.alertIcon)
    await expect(alert).toBeVisible({ timeout: 5000 })

    // Static state - no pulse class yet (the user has not triggered Save).
    await expect(alert).not.toHaveClass(/animate-validation-icon-pulse/)

    // The badge carries the ARIA label so screen readers announce it.
    await expect(alert).toHaveAttribute('aria-label', 'Configuration incomplete')
  })

  test('S2: editing the node clears the alert icon (live FE recompute)', async ({ page }) => {
    await dragHttpToCanvas(page)
    const firstNode = await getFirstWorkflowNode(page)
    await expect(firstNode.locator(SEL.alertIcon)).toBeVisible()

    // Open config and supply the missing required parameter (url). Method
    // already defaults to GET, so satisfying url alone clears the
    // REQUIRED_PARAM_MISSING / REQUIRED_PARAM_EMPTY issues for this node.
    const modal = await openConfigForFirstNode(page)
    await setStringParam(modal, page, 'url', 'https://example.com')
    const modalSave = modal.getByRole('button', { name: 'Save' }).last()
    await expect(modalSave).toBeEnabled()
    await modalSave.click()
    await expect(modal).not.toBeVisible({ timeout: 5000 })

    // The live FE validator recomputes nodeIssues whenever node config
    // changes; with url + method set the node has no issues, so the
    // persistent alert badge disappears entirely.
    await expect(firstNode.locator(SEL.alertIcon)).toHaveCount(0, { timeout: 5000 })
  })

  test('S3: Output binding inline gate disables modal Save when bound to wrong-type variable', async ({
    page,
  }) => {
    // Drag an HTTP node onto the canvas
    await dragHttpToCanvas(page)

    // Create an integer-typed test-local variable via the Variable Manager
    // "Add" button. (HTTP body output is string; binding it to an integer
    // variable triggers the inline gate.) "+ Add" opens the floating
    // create modal.
    await expandVariableManager(page)
    await page.locator(SEL.addVariableBtn).click()
    const createDialog = page.locator('[data-testid="variable-create-modal"]')
    await expect(createDialog).toBeVisible()
    await createDialog.locator('[data-testid="create-variable-name"]').fill('my_int')
    // Switch the type from the default 'string' to 'integer'.
    await createDialog.locator('[data-testid="create-type-select"]').click()
    await page.getByRole('option').filter({ hasText: 'Integer' }).click()
    await createDialog.locator('[data-testid="scalar-edit-input"]').fill('42')
    await createDialog.locator('[data-testid="create-submit-button"]').click()
    await expect(createDialog).not.toBeVisible({ timeout: 5000 })

    // Open HTTP config and set required url so the modal Save button
    // enablement is gated only by the output-binding inline error.
    const modal = await openConfigForFirstNode(page)
    await setStringParam(modal, page, 'url', 'https://example.com')

    // body output (string type): bind it to my_int (integer) by typing.
    const bodyRow = modal.locator('[data-testid="output-row-body"]')
    await expect(bodyRow).toBeVisible()
    const bodyCombobox = bodyRow.locator('textarea[role="combobox"]').first()
    await bodyCombobox.click()
    await bodyCombobox.fill('my_int')
    // Press Tab to commit the typed value and close the popover so the
    // inline error gate runs.
    await page.keyboard.press('Tab')

    // Inline error appears under the row.
    await expect(bodyRow.locator('[role="alert"]')).toContainText('Type mismatch', { timeout: 5000 })
    await expect(bodyRow.locator('[role="alert"]')).toContainText('integer')
    await expect(bodyRow.locator('[role="alert"]')).toContainText('string')

    // Modal Save button is disabled while the inline error stands.
    const modalSave = modal.getByRole('button', { name: 'Save' }).last()
    await expect(modalSave).toBeDisabled()

    // Clear the binding - the inline error disappears, Save re-enables.
    await bodyCombobox.click()
    await bodyCombobox.fill('')
    await page.keyboard.press('Tab')
    await expect(bodyRow.locator('[role="alert"]')).toHaveCount(0)
    await expect(modalSave).toBeEnabled()
  })
})
