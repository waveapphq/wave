/**
 * V-VMGR-PARSER-STRICT: JSON/XML plugin cleanup - strict-string params + blocking validation
 * + the config-modal restructure (VMGR-92).
 *
 * Design decisions: VMGR-88, VMGR-89, VMGR-90, VMGR-91, VMGR-92.
 * REQ: REQ-3.4.2.2, REQ-3.6.2.2, REQ-3.6.2.4, REQ-3.1.3.13.
 *
 * Phase: no-data (parallel) - drops parser / http / setter nodes from the palette;
 * no backend entity data is seeded. The workbench session is cleared per test so
 * the canvas starts empty (see the workbench session-draft-leak lesson).
 *
 * Pass criteria are grouped per describe below. Every group asserts an observable
 * behavior (a disabled/pinned picker, a blocking strip + disabled Save, an eager
 * red field, the section order, a copied error string), never mere existence.
 */

import { test, expect, type Page, type Locator } from '../helpers/playwright-fixtures'
import { dragPaletteItemToCanvas, waitForCanvasLoad } from '../helpers/canvas'
import { BACKEND_URL } from '../helpers/config'
import { configSheet, openSelectedBlockSheet } from '../helpers/workbench'

const sheetOf = (page: Page): Locator => page.locator('[data-testid="value-editor-sheet"]')
const strip = (page: Page): Locator => page.locator('[data-testid="value-editor-validation"]')

async function gotoEmptyWorkbench(page: Page): Promise<void> {
  await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => {})
  await page.goto('/workbench')
  await page.evaluate(() => localStorage.clear())
  await page.goto('/workbench')
  await waitForCanvasLoad(page)
}

/** Drop a palette node, select it, open its config sheet. Returns the config sheet. */
async function dropAndConfig(
  page: Page,
  spec: Parameters<typeof dragPaletteItemToCanvas>[1],
): Promise<Locator> {
  const canvas = page.locator('[data-testid="workflow-canvas"]')
  const box = await canvas.boundingBox()
  await dragPaletteItemToCanvas(page, spec, { x: box!.width / 2, y: box!.height / 2 })

  const node = page.locator('[data-testid^="workflow-node-"][data-nodetype]').first()
  await node.locator('button').first().dispatchEvent('click')
  await expect(node).toHaveAttribute('data-selected', 'true')
  await openSelectedBlockSheet(page)
  const modal = configSheet(page)
  await expect(modal).toBeVisible()
  return modal
}

/** Open a string param's "Edit value" sheet through the row's expand (FIELD-1). */
async function openParamSheet(modal: Locator, page: Page, name: string): Promise<Locator> {
  await modal.locator(`[data-testid="param-expand-${name}"]`).click()
  const sheet = sheetOf(page)
  await expect(sheet).toBeVisible()
  return sheet
}

/** Replace the sheet's CodeMirror text. insertText (not type) so auto-close
 *  brackets do not mangle JSON/XML (mirrors v-plugin-xml-02 / v-table-validation). */
async function setSheetCode(page: Page, sheet: Locator, text: string): Promise<void> {
  const cm = sheet.locator('.cm-content').first()
  await cm.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  if (text) await page.keyboard.insertText(text)
}

const topOf = async (locator: Locator): Promise<number> => {
  const box = await locator.boundingBox()
  if (!box) throw new Error('element has no bounding box')
  return box.y
}

test.describe('V-VMGR-PARSER-STRICT: locked formats, blocking validation, VMGR-92 restructure', () => {
  test.beforeEach(async ({ page }) => {
    await gotoEmptyWorkbench(page)
  })

  // ==========================================================================
  // VMGR-88 / VMGR-90: a single allowedFormats LOCKS the picker (disabled + pinned, no Auto)
  // ==========================================================================
  test('VMGR-88 / VMGR-90: json_content Format picker is disabled, pinned to JSON, no Auto', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')
    const sheet = await openParamSheet(modal, page, 'json_content')

    const fmt = sheet.locator('[data-testid="format-dropdown"]')
    await expect(fmt).toBeVisible()
    // Pinned to JSON, never the live "Auto (...)" detect mode.
    await expect(fmt).toContainText('JSON')
    await expect(fmt).not.toContainText('Auto')
    // Disabled: the strict data param must never be re-detected as something else.
    await expect(fmt).toBeDisabled()
  })

  test('VMGR-88 / VMGR-90: xml_content Format picker is disabled, pinned to XML, no Auto', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'xml')
    const sheet = await openParamSheet(modal, page, 'xml_content')

    const fmt = sheet.locator('[data-testid="format-dropdown"]')
    await expect(fmt).toContainText('XML')
    await expect(fmt).not.toContainText('Auto')
    await expect(fmt).toBeDisabled()
  })

  test('VMGR-88 / VMGR-90: http url, a plain-text field, shows no Format picker and no Format button', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'http')
    const sheet = await openParamSheet(modal, page, 'url')

    // The Kind picker proves the footer rendered before the absences are read.
    await expect(sheet.locator('[data-testid="kind-dropdown"]')).toBeVisible()
    await expect(sheet.locator('[data-testid="format-dropdown"]')).toHaveCount(0)
    await expect(sheet.locator('[data-testid="value-editor-string-format-button"]')).toHaveCount(0)
  })

  // ==========================================================================
  // VMGR-89: a malformed locked-data Literal blocks Save via the ValidationStrip;
  // a valid body clears the strip and re-enables Save.
  // ==========================================================================
  test('VMGR-89: invalid JSON literal shows the blocking strip and disables Save; fixing clears it', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')
    const sheet = await openParamSheet(modal, page, 'json_content')
    const save = sheet.locator('[data-testid="value-editor-save-button"]')

    // Valid JSON -> no strip, Save enabled.
    await setSheetCode(page, sheet, '{"name":"Ada","age":36}')
    await expect(strip(page)).toHaveCount(0)
    await expect(save).toBeEnabled()

    // Invalid JSON -> blocking strip rendered AND Save disabled (cannot persist).
    await setSheetCode(page, sheet, '{"name":"Ada","age":')
    await expect(strip(page)).toBeVisible()
    await expect(save).toBeDisabled()

    // Fixing the JSON clears the strip and re-enables Save.
    await setSheetCode(page, sheet, '{"name":"Ada","age":36}')
    await expect(strip(page)).toHaveCount(0)
    await expect(save).toBeEnabled()
  })

  // ==========================================================================
  // VMGR-91: the un-named query row is outlined red with "Name is required" EAGERLY
  // (no focus/blur), so a disabled Save always has a visible culprit.
  // ==========================================================================
  test('VMGR-91: an empty query alias shows the red border + "Name is required" eagerly', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')

    // The fresh parser starts with one empty query row; its alias error surfaces
    // immediately, before any interaction with the field.
    const alias = modal.locator('[data-testid="json-query-alias-0"]')
    await expect(alias).toBeVisible()
    await expect(alias).toHaveClass(/border-destructive/)
    await expect(
      modal.locator('[data-testid="json-query-row-0"]').locator('[role="alert"]', {
        hasText: 'Name is required',
      }),
    ).toBeVisible()
  })

  // ==========================================================================
  // VMGR-91: at the sheet's minimum width the whole footer fits - the Save
  // button stays inside the sheet.
  // ==========================================================================
  test('VMGR-91: the string Edit sheet keeps Save inside the sheet at minimum width', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')
    const sheet = await openParamSheet(modal, page, 'json_content')
    await setSheetCode(page, sheet, '{"a":1}')

    // Drag the resize handle far left so the width clamps to its minimum.
    const handle = sheet.locator('[data-testid="dialog-resize-handle"]')
    const hb = await handle.boundingBox()
    await page.mouse.move(hb!.x + hb!.width / 2, hb!.y + hb!.height / 2)
    await page.mouse.down()
    await page.mouse.move(hb!.x - 600, hb!.y + hb!.height / 2, { steps: 12 })
    await page.mouse.up()

    // Save's bounding box must sit within the sheet's bounding box (left + right).
    const sheetBox = await sheet.boundingBox()
    const saveBox = await sheet.locator('[data-testid="value-editor-save-button"]').boundingBox()
    expect(saveBox).not.toBeNull()
    expect(saveBox!.x).toBeGreaterThanOrEqual(sheetBox!.x - 1)
    expect(saveBox!.x + saveBox!.width).toBeLessThanOrEqual(sheetBox!.x + sheetBox!.width + 1)
  })

  // ==========================================================================
  // A live text selection in the validation strip owns Ctrl+C, so
  // the canvas node-copy shortcut does NOT hijack it and the error is copyable.
  // ==========================================================================
  test('The selected validation-strip error copies to the clipboard (no canvas hijack)', async ({
    page,
  }) => {
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])

    const modal = await dropAndConfig(page, 'json')
    const sheet = await openParamSheet(modal, page, 'json_content')
    // Invalid JSON -> the strip carries the copyable error message.
    await setSheetCode(page, sheet, '{"name":"Ada","age":')
    await expect(strip(page)).toBeVisible()
    const errorText = (await strip(page).textContent())?.trim() ?? ''
    expect(errorText.length).toBeGreaterThan(0)

    // Select the strip text and blur the editor: the keydown target is now a
    // non-editable element, so only the selection guard lets the
    // browser's native copy run. The JSON parser node stays selected, so without
    // the guard Ctrl+C would copy the node and preventDefault the clipboard write.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="value-editor-validation"]')!
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      const range = document.createRange()
      range.selectNodeContents(el)
      const sel = globalThis.getSelection()!
      sel.removeAllRanges()
      sel.addRange(range)
    })
    await page.keyboard.press('ControlOrMeta+c')

    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain(errorText)
  })

  // ==========================================================================
  // (+N more): the shared ValidationStrip aggregates EVERY problem -
  // the value-editor-sheet complex Code view shows the first error + a "(+N more)"
  // expander that lists all of them.
  // ==========================================================================
  test('(+N more): the complex Code view aggregates all errors and the popover lists every one', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, {
      term: 'var setter',
      testId: 'palette-item-variable-setter',
    })

    // Make the first assignment an Array, then edit its value as Code.
    await modal.locator('[data-testid="varset-type-select-0"]').click()
    await page.getByRole('option', { name: 'Array', exact: true }).click()

    // Open the setter row's value sheet (its own affordance), switch to Code.
    await modal.locator('[data-testid="varset-edit-value-0"]').click()
    const valueSheet = sheetOf(page)
    await expect(valueSheet).toBeVisible()
    await valueSheet.locator('[data-testid="view-dropdown"]').click()
    await page.getByRole('option', { name: 'Code', exact: true }).click()

    // Two 20-digit integers => two "max 19 digits" problems in syntactically valid
    // JSON (the over-cap integer is the named aggregation example).
    await setSheetCode(page, valueSheet, '[12345678901234567890, 23456789012345678901]')
    await expect(strip(page)).toBeVisible()
    const more = page.locator('[data-testid="value-editor-validation-more"]')
    await expect(more).toContainText('(+1 more)')

    await more.click()
    const list = page.locator('[data-testid="value-editor-validation-more-list"]')
    await expect(list).toBeVisible()
    await expect(list.locator('span', { hasText: 'max 19 digits' })).toHaveCount(2)
  })

  // ==========================================================================
  // VMGR-92: the JSON parser config modal is four ordered sections - Input Parameters
  // -> Queries -> Output Mode -> Output Variables - with output_mode promoted out
  // of the input table into a Combined/Individual radio block.
  // ==========================================================================
  test('VMGR-92: section order is Input Parameters -> Queries -> Output Mode -> Output Variables', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')

    // output_mode and queries are not Input Parameters rows.
    await expect(modal.locator('[data-testid="param-row-output_mode"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="param-row-queries"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="param-row-json_content"]')).toBeVisible()

    // Queries is its own section (its Add Query button lives outside the bindings).
    await expect(modal.locator('[data-testid="json-query-add-button"]')).toBeVisible()

    // Output Mode is a radio block defaulting to Combined.
    const combined = modal.locator('#output-mode-combined')
    const individual = modal.locator('#output-mode-individual')
    await expect(combined).toBeVisible()
    await expect(individual).toBeVisible()
    await expect(combined).toHaveAttribute('aria-checked', 'true')

    // Vertical order: json_content row -> Queries -> Output Mode -> Output success.
    const yJsonContent = await topOf(modal.locator('[data-testid="param-row-json_content"]'))
    const yQueries = await topOf(modal.locator('[data-testid="json-query-add-button"]'))
    const yMode = await topOf(combined)
    const ySuccess = await topOf(modal.locator('[data-testid="output-row-success"]'))
    expect(yJsonContent).toBeLessThan(yQueries)
    expect(yQueries).toBeLessThan(yMode)
    expect(yMode).toBeLessThan(ySuccess)
  })

  test('VMGR-92: switching Output Mode to Individual hides Results and shows a per-query type dropdown', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')

    // Combined: Results binding present, no per-query type dropdown.
    await expect(modal.locator('[data-testid="output-row-results"]')).toBeVisible()
    await expect(modal.locator('[data-testid="json-query-type-0"]')).toHaveCount(0)

    // Select Individual via the radio.
    await modal.locator('#output-mode-individual').click()
    await expect(modal.locator('#output-mode-individual')).toHaveAttribute('aria-checked', 'true')

    // Results binding disappears; the per-query type dropdown appears.
    await expect(modal.locator('[data-testid="output-row-results"]')).toHaveCount(0)
    await expect(modal.locator('[data-testid="json-query-type-0"]')).toBeVisible()

    // success + errors bindings remain.
    await expect(modal.locator('[data-testid="output-row-success"]')).toBeVisible()
    await expect(modal.locator('[data-testid="output-row-errors"]')).toBeVisible()
  })

  // ==========================================================================
  // Part 0: json_content carries the {} toggle, and Template stays available.
  // ==========================================================================
  test('Part 0: json_content now shows the {} expression toggle and keeps the Template kind', async ({
    page,
  }) => {
    const modal = await dropAndConfig(page, 'json')

    // The {} expression toggle is on the json_content row.
    await expect(
      modal.locator('[data-testid="param-row-json_content"]').locator('[data-testid="expression-toggle"]'),
    ).toBeVisible()

    // Template is still an offered kind in the Edit sheet (no behavioral loss).
    const sheet = await openParamSheet(modal, page, 'json_content')
    await sheet.locator('[data-testid="kind-dropdown"]').click()
    await expect(page.getByRole('option', { name: 'Template', exact: true })).toBeVisible()
    await expect(page.getByRole('option', { name: 'Literal', exact: true })).toBeVisible()
  })
})
