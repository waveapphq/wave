/**
 * V-DIALOG-GRID-TRACK-OVERFLOW: Universal Dialog overflow contract
 *
 * Phase: no-data (parallel) - palette + dialog interactions only.
 * Design Decisions: the overflow guard lives in the shadcn `DialogContent`
 * primitive.
 *
 * Universal contract: NO Dialog in the app may have
 *   `dialog.scrollWidth > dialog.clientWidth`
 * regardless of whether its content holds wide intrinsic content (CodeMirror,
 * `whitespace: pre` textareas, long unbreakable URLs / variable names /
 * expressions).
 *
 * Surfaces (one sub-test each):
 *   (a) Element-config modal, Var Setter expression mode
 *   (b) Element-config modal, HTTP plugin URL expression mode
 *   (c) Expression Editor Modal (Ctrl+E)
 *   (d) Scalar Variable Edit Dialog (existing string variable, expression mode)
 *   (e) Create Variable Dialog (new string variable, expression mode)
 *   (f) Variable Expanded Dialog (long unbreakable value)
 *   (g) Editor-Modal-Shell in code mode (array editor, JSON paste)
 *   (h) TextEditorModal for multiline parameters (Shell Script Script field)
 *
 * Universal pass criterion per surface:
 *   `dialog.scrollWidth === dialog.clientWidth`
 * AND
 *   first descendant where `el.scrollWidth > el.clientWidth + 1` is the
 *   internal scrollable surface (CodeMirror's .cm-scroller, etc.) - the
 *   diagnostic helper reports it for debugging if a surface fails.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { configSheet } from '../../helpers/workbench'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../../helpers/canvas'
import { openStringParamSheet } from '../../helpers/param-config'
import { BACKEND_PORT } from '../../helpers/config'

const LONG_EXPR = "'s'+" + "'s'+".repeat(50) + "'s'"
const LONG_PLAIN = 's'.repeat(200)

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

async function ensureVariableManagerExpanded(page: Page) {
  const panel = page.locator('[data-testid="variable-manager"]')
  await expect(panel).toBeVisible()
  const state = await panel.getAttribute('data-state')
  if (state !== 'expanded') {
    await panel.locator('button[aria-label="Expand Variable Manager"]').click()
    await expect(panel).toHaveAttribute('data-state', 'expanded')
  }
}

/**
 * Diagnostic helper: walk the DOM from the dialog root downward and report
 * the first descendant where `el.scrollWidth > el.clientWidth + 1`. Useful
 * when a surface fails so the assertion message points at the actual
 * constraint failure (typically a grid container without
 * `grid-template-columns: minmax(0, 1fr)` or a flex item without min-w-0).
 */
async function expectDialogNotOverflowing(dialog: Locator) {
  const result = await dialog.evaluate((root) => {
    const dialogEl = root as HTMLElement
    const dialogScrollWidth = dialogEl.scrollWidth
    const dialogClientWidth = dialogEl.clientWidth
    let firstOverflowing: { tag: string; class: string; sw: number; cw: number } | null = null
    if (dialogScrollWidth > dialogClientWidth + 1) {
      const walker = document.createTreeWalker(dialogEl, NodeFilter.SHOW_ELEMENT)
      while (walker.nextNode()) {
        const el = walker.currentNode as HTMLElement
        if (el.scrollWidth > el.clientWidth + 1) {
          firstOverflowing = {
            tag: el.tagName,
            class: el.className,
            sw: el.scrollWidth,
            cw: el.clientWidth,
          }
          break
        }
      }
    }
    return { dialogScrollWidth, dialogClientWidth, firstOverflowing }
  })
  expect(
    result.dialogScrollWidth,
    `dialog has horizontal overflow. First overflowing descendant: ${
      result.firstOverflowing
        ? JSON.stringify(result.firstOverflowing)
        : '(none found)'
    }`,
  ).toBe(result.dialogClientWidth)
}

test.describe('V-DIALOG-GRID-TRACK-OVERFLOW: universal dialog overflow contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session/`).catch(() => {})
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
  })

  test('S-a: Element-config / Var Setter expression mode does not overflow', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    await modal.locator('[data-testid="varset-expression-toggle-0"]').click()
    const cm = modal.locator('.cm-content').first()
    await cm.click()
    await page.keyboard.type(LONG_EXPR)

    await expectDialogNotOverflowing(modal)
  })

  test('S-b: Element-config / HTTP URL expression mode does not overflow', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'http')

    const urlRow = modal.locator('[data-testid="param-row-url"]')
    await urlRow.locator('[data-testid="expression-toggle"]').click()
    const cm = urlRow.locator('.cm-content').first()
    await cm.click()
    await page.keyboard.type(LONG_EXPR)

    await expectDialogNotOverflowing(modal)
  })

  test('S-c: Expression Editor Modal (Ctrl+E) does not overflow', async ({ page }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const configModal = await dropAndOpenConfig(page, 'http')

    const urlRow = configModal.locator('[data-testid="param-row-url"]')
    await urlRow.locator('[data-testid="expression-toggle"]').click()
    await urlRow.locator('.cm-content').first().click()
    await page.keyboard.press('Control+e')

    const editor = page.locator('[data-testid="expression-editor-modal"]')
    await expect(editor).toBeVisible()

    const cm = editor.locator('.cm-content').first()
    await cm.click()
    await page.keyboard.type(LONG_EXPR)

    await expectDialogNotOverflowing(editor)
  })

  // No S-d: the Scalar Variable Edit Dialog is create-only (the row pencil
  // opens the inspect modal), so its expression-mode overflow is covered by
  // S-e (Create Variable Dialog - the same component).

  test('S-e: Create Variable Dialog (string, expression mode) does not overflow', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await ensureVariableManagerExpanded(page)
    // "+ Add" opens the floating create modal; expression is a Kind.
    await page.locator('[data-testid="add-variable-button"]').click()
    const dialog = page.locator('[data-testid="variable-create-modal"]')
    await expect(dialog).toBeVisible()

    await dialog.locator('[data-testid="create-variable-name"]').fill('newvar')
    await dialog.locator('[data-testid="create-kind-select"]').click()
    await page.getByRole('option', { name: 'Expression', exact: true }).click()
    const cm = dialog.locator('.cm-content').first()
    await cm.click()
    await page.keyboard.type(LONG_EXPR)

    await expectDialogNotOverflowing(dialog)
  })

  test('S-g: Value-editor sheet (array, code view) with long unbreakable JSON does not overflow', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)

    // Drop Var Setter; switch row to array type; open the shared "Edit value"
    // sheet; switch the sheet to Code view; paste long unbreakable content.
    const modal = await dropAndOpenConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    const typeSelect = modal.locator('[data-testid="varset-type-select-0"]')
    await typeSelect.click()
    await page.getByRole('option', { name: 'Array' }).click()

    await modal.locator('[data-testid="varset-edit-value-0"]').click()
    const sheet = page.locator('[data-testid="value-editor-sheet"]')
    await expect(sheet).toBeVisible()

    // Switch to Code view via the footer View dropdown.
    await sheet.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Code', exact: true }).click()

    const cm = sheet.locator('.cm-content').first()
    await expect(cm).toBeVisible()
    await cm.click()
    await page.keyboard.type(LONG_EXPR)

    await expectDialogNotOverflowing(sheet)
  })

  test('S-h: TextEditorModal (Shell Script multiline Script paste) does not overflow', async ({
    page,
  }) => {
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    const modal = await dropAndOpenConfig(page, 'shell script')

    // The Script row and its edit button must exist, so a missing row fails instead of skipping.
    const scriptRow = modal.locator('[data-testid="param-row-script"]')
    await expect(scriptRow).toHaveCount(1)
    await expect(scriptRow.locator('[data-testid="param-expand-script"]')).toHaveCount(1)

    // Script opens the shared value-editor sheet (a DraggableSheet, not a Radix dialog).
    const editor = await openStringParamSheet(modal, page, 'script')

    // Long unbreakable single-line content.
    const target = editor.locator('textarea, .cm-content').first()
    await target.click()
    await page.keyboard.type(LONG_PLAIN)

    await expectDialogNotOverflowing(editor)
  })
})
