/**
 * V-EXPRESSION-EDITOR-MODAL-TITLES: Modal title routing per context
 *
 * Phase: no-data (parallel) - palette + element-config interactions only.
 *
 * Pass Criteria:
 *   The Ctrl+E full-editor modal title is `Edit ${displayName}`, falling back
 *   to "Edit expression" when no displayName flows through. Concretely:
 *     1. HTTP Client URL parameter (label "URL"): "Edit URL".
 *     2. Var Setter row with name="myvar": "Edit myvar".
 *     3. Assert top-level expression item: "Edit assertion expression".
 *     4. Assert reference-value (expression mode) with variable selected:
 *        "Edit ${variable}".
 *
 *   Note on the URL label: the HTTP plugin schema in
 *   `frontend/src/features/workbench/lib/node-parameters/plugins/http-client.ts`
 *   defines the parameter label as `"URL"` (not `"Request URL"`). Production
 *   behavior follows the schema; this spec asserts on the schema's value so it
 *   pins the actual contract end users see.
 *
 *   Note on Var Setter row with empty name: the production code in
 *   `variable-setter-editor/row-fields.tsx` passes `name={row.name || \`row-${index}\`}`
 *   without a `displayName`, so an empty row produces "Edit row-0". This spec
 *   covers the named-row case only.
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

  test('S3: Assert top-level expression -> "Edit assertion expression"', async ({
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
      .locator('[data-testid^="assert-expression-input-"] .cm-content')
      .first()
    const editor = await openCtrlEFrom(page, assertCm)
    await expectTitle(editor, 'Edit assertion expression')
  })
})
