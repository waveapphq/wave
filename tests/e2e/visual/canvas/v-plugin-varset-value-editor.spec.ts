/**
 * V-PLUGIN-VARSET-VALUE-EDITOR: the shared "Edit value" sheet the Variable
 * Setter opens for a string or complex row value.
 *
 * Phase: no-data (parallel) - drops a Var Setter; no backend data needed.
 * Design Decisions: VMGR-84, VMGR-85 (Kind dropdown; static header, no Mode
 * pill, no name; complex View dropdown).
 * REQ: REQ-3.1.3.11, REQ-3.4.1.14, REQ-3.1.3.15.
 *
 * Pass Criteria:
 * 1. String sheet: static "Edit value" header + STRING badge, NO name input,
 *    NO Mode pill; footer = Kind (Literal) + Format dropdowns + Cancel/Save.
 * 2. Kind=Template hides the Format dropdown (Template state, VMGR-84).
 * 3. Complex (array) sheet: ARRAY badge, View (Visual) dropdown + metric, NO
 *    Kind/Format dropdown, NO Mode pill; switching View=Code reveals Format.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { configSheet, openSelectedBlockSheet } from '../../helpers/workbench'

async function dropVarSetterAndOpenConfig(page: Page): Promise<Locator> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(
    page,
    { term: 'var setter', testId: 'palette-item-variable-setter' },
    { x: cb!.width / 2, y: cb!.height / 2 },
  )
  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function openValueSheet(page: Page, modal: Locator): Promise<Locator> {
  await modal.locator('[data-testid="varset-edit-value-0"]').click()
  const sheet = page.locator('[data-testid="value-editor-sheet"]')
  await expect(sheet).toBeVisible()
  return sheet
}

test.describe('V-PLUGIN-VARSET-VALUE-EDITOR: shared Edit value sheet', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await waitForCanvasLoad(page)
  })

  // ==========================================================================
  // S1: String sheet - header, badge, Kind + Format, no Mode pill, no name
  // ==========================================================================
  test('V-PLUGIN-VARSET-VALUE-EDITOR-S1: string sheet header + Kind/Format footer, no Mode pill', async ({
    page,
  }) => {
    const modal = await dropVarSetterAndOpenConfig(page)
    const sheet = await openValueSheet(page, modal)

    // Static header: "Edit value" + STRING type badge.
    await expect(sheet.getByText('Edit value')).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('string')

    // No variable name field, no Mode pill or value pill (the sheet edits the value).
    await expect(sheet.locator('[data-testid="create-variable-name"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="mode-dropdown"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="value-switch"]')).toHaveCount(0)

    // Footer: Kind (Literal) + Format dropdowns + Cancel/Save.
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toContainText('Literal')
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-cancel-button"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="value-editor-save-button"]')).toBeVisible()

    // String body present; complex View dropdown absent for a string value.
    await expect(sheet.locator('.cm-content').first()).toBeVisible()
    await expect(sheet.locator('[data-testid="view-dropdown"]')).toHaveCount(0)
  })

  // ==========================================================================
  // S2: Kind=Template hides Format (template state, VMGR-84)
  // ==========================================================================
  test('V-PLUGIN-VARSET-VALUE-EDITOR-S2: Kind=Template hides the Format dropdown', async ({
    page,
  }) => {
    const modal = await dropVarSetterAndOpenConfig(page)
    const sheet = await openValueSheet(page, modal)

    // Literal: Format visible.
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toBeVisible()

    // Switch Kind -> Template.
    await sheet.locator('[data-testid="kind-dropdown"]').click()
    await page.getByRole('option', { name: 'Template', exact: true }).click()
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toContainText('Template')

    // Template hides Format and keeps the string editor for the {{ }} content.
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toHaveCount(0)
    await expect(sheet.locator('.cm-content').first()).toBeVisible()
  })

  // ==========================================================================
  // S3: Complex (array) sheet - View dropdown + metric, no Kind/Format/Mode
  // ==========================================================================
  test('V-PLUGIN-VARSET-VALUE-EDITOR-S3: array sheet View/metric, Code reveals Format, no Mode pill', async ({
    page,
  }) => {
    const modal = await dropVarSetterAndOpenConfig(page)

    // Change the row to Array, then open the sheet.
    await modal.locator('[data-testid="varset-type-select-0"]').click()
    await page.getByRole('option', { name: 'Array', exact: true }).click()
    const sheet = await openValueSheet(page, modal)

    // Header: ARRAY badge; no Mode pill.
    await expect(sheet.locator('[data-testid="value-editor-type-badge"]')).toContainText('array')
    await expect(sheet.locator('[data-testid="mode-dropdown"]')).toHaveCount(0)

    // Footer: View (Visual) + metric; NO Kind/Format dropdown for complex.
    await expect(sheet.locator('[data-testid="view-dropdown"]')).toContainText('Visual')
    await expect(sheet.locator('[data-testid="value-editor-metric"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toHaveCount(0)

    // Switching to Code reveals the Format button (Format-in-Code, VMGR-85).
    await sheet.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Code', exact: true }).click()
    await expect(sheet.locator('[data-testid="value-editor-format-button"]')).toBeVisible()
  })
})
