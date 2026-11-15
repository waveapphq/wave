/**
 * V-EXPRESSION-EDITOR-MODAL-TITLES: Modal title routing per context
 * REQ: REQ-3.5.1.5, REQ-3.4.1.14
 * Phase: no-data (parallel) - palette + element-config interactions only.
 *
 * Pass Criteria:
 *   The Ctrl+E full-editor modal title is `Edit ${label}`, falling back
 *   to "Edit expression" when the label is empty. Concretely:
 *     1. HTTP Client URL parameter (label "URL"): "Edit URL".
 *     2. Var Setter row with name="myvar": "Edit myvar".
 *     3. Assert top-level expression row: "Edit Condition".
 *     4. Assert compare value in expression mode: "Edit Value".
 *     5. Var Setter row with no name in expression mode: "Edit expression".
 *
 *   Note on the URL label: the HTTP plugin schema in
 *   `frontend/src/features/workbench/lib/node-parameters/plugins/http-client.ts`
 *   defines the parameter label as `"URL"` (not `"Request URL"`). Production
 *   behavior follows the schema; this spec asserts on the schema's value so it
 *   pins the actual contract end users see.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'

async function dropAndOpenConfig(
  page: Page,
  spec: { term: string; testId: string } | string,
) {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const cb = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, spec, {
    x: cb!.width / 2,
    y: cb!.height / 2,
  })
  const node = page
    .locator('[data-testid^="workflow-node-"][data-nodetype]')
    .first()
  await node.locator('button').first().dispatchEvent('click')
  await page
    .locator('[data-testid="node-configure"]')
    .click()
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

async function openCtrlEFrom(page: Page, cmContent: Locator) {
  await cmContent.click()
  await page.keyboard.press('Control+e')
  const editor = page.locator('[data-testid="expression-editor-modal"]')
  await expect(editor).toBeVisible()
  return editor
}

async function expectTitle(modal: Locator, title: string) {
  // DialogTitle renders within the modal; it is the only h2 inside.
  await expect(modal.locator('h2').first()).toHaveText(title)
}

test.describe('V-EXPRESSION-EDITOR-MODAL-TITLES: title routing per context', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S1: HTTP URL parameter -> "Edit URL"', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'http')

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await urlRow.locator('[data-testid="expression-toggle"]').click()
    const editor = await openCtrlEFrom(page, urlRow.locator('.cm-content').first())
    await expectTitle(editor, 'Edit URL')
  })

  test('S2: Var Setter row name="myvar" -> "Edit myvar"', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    await modal.locator('[data-testid="varset-name-input-0"]').fill('myvar')
    // Dismiss autocomplete by moving focus to a neutral control; then toggle
    // expression. (Clicking the string row's Edit button would open the value
    // sheet, and Escape would cancel the modal.)
    await modal.locator('[data-testid="varset-add-button"]').focus()
    await modal.locator('[data-testid="varset-expression-toggle-0"]').click()
    const cm = modal.locator('.cm-content').first()
    const editor = await openCtrlEFrom(page, cm)
    await expectTitle(editor, 'Edit myvar')
  })

  test('S3: Assert top-level expression -> "Edit Condition"', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'assert')

    // Add an expression-style assertion so the inline CodeMirror appears.
    await modal.locator('[data-testid="assert-add-assertion"]').click()
    await modal.locator('[data-testid="assert-add-expression"]').click()

    const exprIcon = modal.locator('[data-testid^="assert-expression-icon-"]').first()
    await expect(exprIcon).toBeVisible()
    const assertCm = modal
      .locator('[data-testid^="param-input-assert-expr-"] .cm-content')
      .first()
    const editor = await openCtrlEFrom(page, assertCm)
    await expectTitle(editor, 'Edit Condition')
  })

  test('S4: Assert compare value in expression mode -> "Edit Value"', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'assert')

    await modal.locator('[data-testid="assert-add-assertion"]').click()
    await modal.locator('[data-testid="assert-add-literal"]').click()
    await modal.locator('[data-testid="assert-expr-toggle-0"]').click()
    const valueCm = modal.locator('[data-testid="param-input-assert-value-0"] .cm-content')
    await expect(valueCm).toBeVisible()
    const editor = await openCtrlEFrom(page, valueCm)
    await expectTitle(editor, 'Edit Value')
  })

  test('S5: Var Setter row with no name -> "Edit expression"', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    await expect(modal.locator('[data-testid="varset-name-input-0"]')).toHaveValue('')
    await modal.locator('[data-testid="varset-expression-toggle-0"]').click()
    const valueCm = modal.locator('[data-testid="param-input-varset-value-0"] .cm-content')
    await expect(valueCm).toBeVisible()
    const editor = await openCtrlEFrom(page, valueCm)
    await expectTitle(editor, 'Edit expression')
  })
})
