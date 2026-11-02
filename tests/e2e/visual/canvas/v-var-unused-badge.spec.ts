/**
 * V-VAR-UNUSED-BADGE: Variable Manager - Unused Indicator
 *
 * Phase: no-data (parallel) - opens /workbench against the empty Draft Workflow,
 * creates variables and a workflow node entirely in the local Zustand store.
 * Design Decisions: in-row span pattern, cross-variable refs.
 *
 * Pass Criteria:
 * 1. Create variable `myvar` of type string with no references; the row in
 *    All Variables shows the Unused badge with text exactly "Unused".
 * 2. Reference `myvar` as an input expression on a workflow node; on save,
 *    the badge disappears from the row.
 * 3. Remove the workflow reference and create a second variable `total` of
 *    type integer with computed expression `myvar + 1`; the badge stays
 *    hidden because `myvar` is now referenced by another variable's expression.
 * 4. Remove `total`; the badge reappears on `myvar`. Tooltip text is exactly
 *    "Not referenced by any block or other variable."
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { insertCodeValue } from '../../helpers/variable-create'
import { configSheet } from '../../helpers/workbench'

async function expandVariableManager(page: Page) {
  const panel = page.locator('[data-testid="variable-manager"]')
  const state = await panel.getAttribute('data-state')
  if (state === 'collapsed') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

/** The badge explains itself through the shared tooltip, not a browser `title`. */
async function expectBadgeTooltip(page: Page, badge: Locator) {
  await expect(badge).not.toHaveAttribute('title', /.*/)
  await badge.hover()
  const tooltip = page.locator('[data-slot="tooltip-content"]:not([data-state="closed"])')
  await expect(tooltip).toBeVisible({ timeout: 5_000 })
  await expect(tooltip).toContainText('Not referenced by any block or other variable.')
  await page.mouse.move(2, 2)
  await expect(tooltip).toHaveCount(0)
}

async function getVariableId(page: Page, name: string): Promise<string> {
  const row = page.locator(
    `[data-testid^="variable-row-"][aria-label="Variable ${name}"]`,
  )
  await expect(row).toBeVisible()
  const testId = await row.getAttribute('data-testid')
  return testId!.replace('variable-row-', '')
}

async function createVariableViaDialog(
  page: Page,
  args: { name: string; type?: string; value?: string; expression?: string },
) {
  // "+ Add" opens the floating create modal.
  await page.locator('[data-testid="add-variable-button"]').click()
  const dialog = page.locator('[data-testid="variable-create-modal"]')
  await expect(dialog).toBeVisible()

  await dialog.locator('[data-testid="create-variable-name"]').fill(args.name)

  if (args.type && args.type !== 'string') {
    await dialog.locator('[data-testid="create-type-select"]').click()
    await page.getByRole('option', { name: new RegExp(`^${args.type}`, 'i') }).first().click()
  }

  if (args.expression !== undefined) {
    await dialog.locator('[data-testid="create-kind-select"]').click()
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    const cm = dialog.locator('.cm-content').first()
    await cm.click()
    // Clear any literal pre-population (the dialog seeds the expression
    // field with the stringified literal value when toggling to expression
    // mode) so the typed expression replaces it instead of concatenating.
    await page.keyboard.press('Control+a')
    await page.keyboard.press('Delete')
    await page.keyboard.type(args.expression)
    // Blur the expression editor (click the name input) so the cycle validator runs.
    await dialog.locator('[data-testid="create-variable-name"]').click()
  } else if (args.value !== undefined) {
    await insertCodeValue(page, args.value, dialog)
  }

  await dialog.locator('[data-testid="create-submit-button"]').click()
  await expect(dialog).not.toBeVisible()
}

async function deleteVariable(page: Page, name: string) {
  const id = await getVariableId(page, name)
  await page.locator(`[data-testid="delete-button-${id}"]`).click()
  // Variables without bindings/refs delete immediately (no confirm dialog).
  // For variables that ARE referenced, the delete confirmation modal appears.
  const confirmDialog = page.locator('[role="alertdialog"]')
  if (await confirmDialog.isVisible({ timeout: 500 }).catch(() => false)) {
    await confirmDialog.getByRole('button', { name: /^delete/i }).click()
  }
  await expect(
    page.locator(`[aria-label="Variable ${name}"]`),
  ).not.toBeVisible()
}

test.describe('V-VAR-UNUSED-BADGE: Unused indicator on variable rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandVariableManager(page)
  })

  test('S1: badge appears on a freshly-created unreferenced variable', async ({ page }) => {
    await createVariableViaDialog(page, { name: 'myvar_s1', value: 'hello' })

    const id = await getVariableId(page, 'myvar_s1')
    const badge = page.locator(`[data-testid="unused-badge-${id}"]`)
    await expect(badge).toBeVisible()
    await expect(badge).toHaveText('Unused')
    await expectBadgeTooltip(page, badge)
  })

  test('S2: badge disappears when variable is referenced by a workflow node', async ({ page }) => {
    await createVariableViaDialog(page, { name: 'myvar_s2', value: 'hello' })
    const id = await getVariableId(page, 'myvar_s2')
    await expect(page.locator(`[data-testid="unused-badge-${id}"]`)).toBeVisible()

    // Drop a Log node and configure its message to reference `myvar_s2`.
    const canvas = page.locator('[data-testid="workflow-canvas"]')
    const canvasBox = await canvas.boundingBox()
    await dragPaletteItemToCanvas(page, 'log', {
      x: canvasBox!.width / 2,
      y: canvasBox!.height / 2,
    })
    const logNode = page
      .locator('[data-testid^="workflow-node-"][data-nodetype]')
      .last()
    // dispatchEvent('click') matches the pattern used by other node tests;
    // a plain click can race with React Flow selection state under load.
    await logNode.locator('button').first().dispatchEvent('click')
    await expect(logNode).toHaveAttribute('data-selected', 'true', { timeout: 5000 })

    // Open config modal via the gear in the action row
    const gear = page.locator('[data-testid="node-configure"]').first()
    await expect(gear).toBeEnabled({ timeout: 5000 })
    await gear.click()
    // Identify the config modal by its parameter row, not by title text.
    const modal = configSheet(page)
      .filter({ has: page.locator('[data-testid="param-row-message"]') })
    await expect(modal).toBeVisible()

    // The Log message field defaults to literal text mode. The
    // `workflowReferencedVarNames` walker only scans values whose param
    // name is in the node's `expressionFields` set, so we must toggle
    // expression mode before the reference will register.
    const messageRow = modal.locator('[data-testid="param-row-message"]')
    await messageRow.locator('[data-testid="expression-toggle"]').click()
    const messageInput = modal.locator('[data-testid="param-input-message"] .cm-content').first()
    await expect(messageInput).toBeVisible()
    await messageInput.click()
    await page.keyboard.press('Control+a')
    await page.keyboard.type('myvar_s2')

    // Save the config modal so the workflow node carries the reference.
    await modal.getByRole('button', { name: /^save$/i }).click()
    await expect(modal).not.toBeVisible()

    // The badge should disappear once the node references myvar_s2 in its message expression.
    await expect(page.locator(`[data-testid="unused-badge-${id}"]`)).not.toBeVisible()
  })

  test('S3+S4: cross-variable expression keeps badge hidden, removing it brings it back', async ({ page }) => {
    await createVariableViaDialog(page, { name: 'myvar_s3', value: 'hello' })
    const id = await getVariableId(page, 'myvar_s3')
    await expect(page.locator(`[data-testid="unused-badge-${id}"]`)).toBeVisible()

    // Create a second variable whose expression references myvar_s3.
    await createVariableViaDialog(page, {
      name: 'total_s3',
      type: 'integer',
      expression: 'myvar_s3 + 1',
    })

    // Badge on myvar_s3 hides because total_s3's expression references it.
    await expect(page.locator(`[data-testid="unused-badge-${id}"]`)).not.toBeVisible()

    // Delete total_s3 - badge reappears on myvar_s3.
    await deleteVariable(page, 'total_s3')
    await expect(page.locator(`[data-testid="unused-badge-${id}"]`)).toBeVisible()
    await expectBadgeTooltip(page, page.locator(`[data-testid="unused-badge-${id}"]`))
  })
})
