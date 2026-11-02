/**
 * V-VMGR-CREATE-COMPLEX: a complex value (table / array / map) of a New variable window is
 * edited in the "Edit value" window its Open editor opens: the Code editor, the validation
 * strip, numeric caps, and per-element types.
 * Design Decisions: VMGR-70, VMGR-71, VMGR-82, VMGR-110
 * REQ: REQ-3.1.3.14, REQ-3.1.3.19, REQ-3.5.5.1
 *
 * Phase: functional-workflow (seeds an empty Test, no run).
 *
 * Each step opens a fresh New variable window of a complex type, opens its "Edit value"
 * window and drives the Visual / Code editor there.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_PORT } from '../../helpers/config'
import { createValidTest, openTest } from '../../helpers/fn-seed'
import {
  answerChangeConfirm,
  cancelCreate,
  closeValueEditor,
  openCreateModal,
  openValueEditor,
  replaceValueEditorCode,
  saveValueEditor,
  setCreateName,
  setCreateType,
  setValueEditorView,
  valueEditorCode,
  valueField,
} from '../../helpers/variable-create'

const OVER_CAP_INT = '1'.repeat(20) // 20 digits > the 19-digit integer cap
const BIG_INT = '1234567890123456789' // exactly 19 digits (at the cap)

interface ComplexEditor {
  win: Locator
  sheet: Locator
}

/** A New variable window of `type`, with its "Edit value" window open on Visual. */
async function openComplex(page: Page, name: string, type: string): Promise<ComplexEditor> {
  const win = await openCreateModal(page)
  await setCreateName(page, name, win)
  await setCreateType(page, type, win)
  const sheet = await openValueEditor(page, win)
  return { win, sheet }
}

/** Close the "Edit value" window, dropping a change when it asks, and cancel the New variable window. */
async function discard(page: Page, editor: ComplexEditor): Promise<void> {
  const question = page.locator('[data-testid="value-editor-unsaved-dialog"]')
  await editor.sheet.locator('[data-testid="value-editor-cancel-button"]').click()
  // Text that never parsed changed no value, so only some steps ask.
  await expect
    .poll(async () => (await question.isVisible()) || (await editor.sheet.count()) === 0)
    .toBe(true)
  if (await question.isVisible()) await question.locator('[data-testid="value-editor-unsaved-discard-button"]').click()
  await expect(editor.sheet).toBeHidden()
  await cancelCreate(page, editor.win)
}

const strip = (sheet: Locator): Locator => sheet.locator('[data-testid="value-editor-validation"]')
const sheetSave = (sheet: Locator): Locator => sheet.locator('[data-testid="value-editor-save-button"]')

test.describe('V-VMGR-CREATE-COMPLEX: complex-type editor', () => {
  test('table + array + map Code editor, caps, strip, per-element types', async ({
    page,
    request,
  }) => {
    test.setTimeout(180_000)
    const testId = await createValidTest(request, {
      name: `V-VMGR-CREATE-COMPLEX ${Date.now()}`,
      nodes: [],
    })
    await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
    await openTest(page, testId)

    await test.step('Open editor offers a Visual/Code switch and a Format button', async () => {
      const editor = await openComplex(page, 'tbl1', 'table')
      await expect(editor.sheet.locator('[data-testid="view-dropdown"]')).toBeVisible()
      await setValueEditorView(page, editor.sheet, 'Code')
      await expect(editor.sheet.locator('[data-testid="code-body"]')).toBeVisible()
      await expect(editor.sheet.locator('[data-testid="value-editor-format-button"]')).toBeVisible()
      await discard(page, editor)
    })

    await test.step('a JSON syntax error shows alone with its line, locks Visual, disables Save + Format', async () => {
      const editor = await openComplex(page, 'tbl2', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[{"id": 1},')
      await expect(strip(editor.sheet)).toBeVisible()
      // The parser's own precise message shows ALONE (not the generic "invalid
      // JSON", and no "(+N more)" expander while a precise message is available).
      await expect(strip(editor.sheet)).toContainText(/Unexpected|Expected|Line \d+/)
      await expect(strip(editor.sheet)).not.toHaveText('invalid JSON')
      await expect(strip(editor.sheet)).not.toContainText('(+')
      // Save + Format are blocked while the JSON is broken.
      await expect(sheetSave(editor.sheet)).toBeDisabled()
      await expect(editor.sheet.locator('[data-testid="value-editor-format-button"]')).toBeDisabled()
      // The Visual option is locked (alert icon) while the JSON is invalid.
      await editor.sheet.locator('[data-testid="view-dropdown"]').click()
      await expect(page.locator('[data-testid="view-locked-alert"]')).toBeVisible()
      await page.keyboard.press('Escape')
      await discard(page, editor)
    })

    await test.step('a big integer renders as a bare number in Code and its exact string in Visual', async () => {
      const editor = await openComplex(page, 'tbl3', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, `[{"id": ${BIG_INT}}]`)
      // Code shows the bare 19-digit number literal (not quoted).
      await expect(valueEditorCode(editor.sheet)).toContainText(BIG_INT)
      // Switch to Visual: the cell shows the exact string, columns carried.
      await setValueEditorView(page, editor.sheet, 'Visual')
      await expect(editor.sheet.locator('[data-testid="table-cell-0-0"]')).toHaveValue(BIG_INT)
      await discard(page, editor)
    })

    await test.step('an over-cap integer is flagged in Code with its cell line', async () => {
      const editor = await openComplex(page, 'tbl4', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, `[\n  {"id": ${OVER_CAP_INT}}\n]`)
      await expect(strip(editor.sheet)).toContainText('max 19 digits')
      await expect(strip(editor.sheet)).toContainText(/Line \d+:/)
      await expect(sheetSave(editor.sheet)).toBeDisabled()
      await discard(page, editor)
    })

    await test.step('a table integer cell hard-stops a non-numeric char and the 20th digit', async () => {
      const editor = await openComplex(page, 'tbl5', 'table')
      // Author one int column + row via Code, then edit the Visual cell.
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[{"id": 1}]')
      await setValueEditorView(page, editor.sheet, 'Visual')
      const cell = editor.sheet.locator('[data-testid="table-cell-0-0"]')
      await cell.click()
      await page.keyboard.press('ControlOrMeta+a')
      await page.keyboard.press('Delete')
      await page.keyboard.type('12x3') // the 'x' must be dropped
      await expect(cell).toHaveValue('123')
      // Filling exactly 19 digits is allowed; a 20th never enters.
      await cell.fill(BIG_INT)
      await page.keyboard.type('9')
      await expect(cell).toHaveValue(BIG_INT)
      await discard(page, editor)
    })

    await test.step('typed digits stay a string (REQ-3.1.3.19); an opening brace commits to map', async () => {
      const editor = await openComplex(page, 'arr1', 'array')
      await editor.sheet.locator('[data-testid="array-add-item"]').click()
      const cell = editor.sheet.locator('[data-testid="array-edit-input-0"]')
      await cell.fill('123')
      await expect(editor.sheet.locator('[data-testid="array-type-0"]')).toHaveText('string')
      await cell.fill('{"a":1}')
      await expect(editor.sheet.locator('[data-testid="array-type-0"]')).toHaveText('map')
      // Invalid JSON for the committed map type flags the cell + strip.
      await cell.fill('{bad}')
      await expect(cell).toHaveAttribute('aria-invalid', 'true')
      await expect(strip(editor.sheet)).toContainText('Index 0')
      await discard(page, editor)
    })

    await test.step('a map key cell flags red when the key is missing', async () => {
      const editor = await openComplex(page, 'map1', 'map')
      await editor.sheet.locator('[data-testid="map-add-entry"]').click()
      // A value with no key flags the key cell + a located strip.
      await editor.sheet.locator('[data-testid="map-edit-value-0"]').fill('1')
      await expect(editor.sheet.locator('[data-testid="map-edit-key-0"]')).toHaveAttribute(
        'aria-invalid',
        'true',
      )
      await expect(strip(editor.sheet)).toContainText('key missing')
      await discard(page, editor)
    })

    await test.step('a multi-problem strip shows the first plus a "(+N more)" expander listing every problem', async () => {
      const editor = await openComplex(page, 'tbl6', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      // Column n is integer (row 0); rows 1 + 2 hold strings -> two cell errors.
      await replaceValueEditorCode(page, editor.sheet, '[{"n": 1}, {"n": "x"}, {"n": "y"}]')
      await expect(strip(editor.sheet)).toBeVisible()
      const more = editor.sheet.locator('[data-testid="value-editor-validation-more"]')
      await expect(more).toHaveText('(+1 more)')
      await more.click()
      const list = page.locator('[data-testid="value-editor-validation-more-list"]')
      await expect(list).toContainText('Row 1 "n": expected integer')
      await expect(list).toContainText('Row 2 "n": expected integer')
      await page.keyboard.press('Escape')
      await expect(list).toBeHidden()
      await discard(page, editor)
    })

    await test.step('a reachable-but-incomplete numeric cell (lone "-") is flagged and holds Save', async () => {
      const editor = await openComplex(page, 'tbl7', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[{"id": 1}]')
      await setValueEditorView(page, editor.sheet, 'Visual')
      const cell = editor.sheet.locator('[data-testid="table-cell-0-0"]')
      await cell.fill('-')
      await expect(cell).toHaveAttribute('aria-invalid', 'true')
      await expect(sheetSave(editor.sheet)).toBeDisabled()
      await discard(page, editor)
    })

    await test.step('a nested number keeps its exact text (123.0 is not normalized to 123)', async () => {
      const editor = await openComplex(page, 'arr2', 'array')
      await editor.sheet.locator('[data-testid="array-add-item"]').click()
      const cell = editor.sheet.locator('[data-testid="array-edit-input-0"]')
      await cell.fill('{"hi":123.0}')
      await expect(editor.sheet.locator('[data-testid="array-type-0"]')).toHaveText('map')
      await expect(cell).toHaveValue('{"hi":123.0}')
      await expect(cell).not.toHaveAttribute('aria-invalid', 'true')
      await discard(page, editor)
    })

    await test.step('a nested over-cap float flags a located message + holds Save, but keeps Visual available (not a syntax lock)', async () => {
      const editor = await openComplex(page, 'arr3', 'array')
      await setValueEditorView(page, editor.sheet, 'Code')
      // A nested float with > 28 significant digits is over the cap.
      await replaceValueEditorCode(page, editor.sheet, `[\n  {"x": 1.${'2'.repeat(30)}}\n]`)
      await expect(strip(editor.sheet)).toContainText('nested float exceeds 28 significant digits')
      await expect(strip(editor.sheet)).toContainText(/Line \d+/)
      await expect(sheetSave(editor.sheet)).toBeDisabled()
      // The JSON parses, so the semantic error must NOT lock the Visual switch.
      await editor.sheet.locator('[data-testid="view-dropdown"]').click()
      await expect(page.locator('[data-testid="view-locked-alert"]')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await discard(page, editor)
    })

    await test.step('the typed JSON defines its own columns (carried to Visual with inferred types); a non-row-list holds Save + locks Visual', async () => {
      const editor = await openComplex(page, 'tbl8', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[{"id": 1, "name": "x"}]')
      await setValueEditorView(page, editor.sheet, 'Visual')
      await expect(editor.sheet.locator('[data-testid="table-header-0"]')).toHaveValue('id')
      await expect(editor.sheet.locator('[data-testid="table-type-0"]')).toHaveText('integer')
      await expect(editor.sheet.locator('[data-testid="table-header-1"]')).toHaveValue('name')
      // Back to Code; a non-row-list holds Save + locks Visual.
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[1, 2, 3]')
      await expect(sheetSave(editor.sheet)).toBeDisabled()
      await editor.sheet.locator('[data-testid="view-dropdown"]').click()
      await expect(page.locator('[data-testid="view-locked-alert"]')).toBeVisible()
      await page.keyboard.press('Escape')
      await discard(page, editor)
    })

    await test.step('a table cell type error names the JSON line of the bad cell', async () => {
      const editor = await openComplex(page, 'tbl9', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      // Column c2 is integer (row 0); row 1's string cell mismatches on line 3.
      await replaceValueEditorCode(page, editor.sheet, '[\n  {"c1": "a", "c2": 1},\n  {"c1": "x", "c2": "y"}\n]')
      await expect(strip(editor.sheet)).toContainText('Row 1 "c2": expected integer')
      await expect(strip(editor.sheet)).toContainText(/Line \d+/)
      await discard(page, editor)
    })

    await test.step('the validation strip text is selectable (select-text beats the sheet select-none)', async () => {
      const editor = await openComplex(page, 'tbl10', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[{"id": 1},')
      await expect(strip(editor.sheet)).toBeVisible()
      await expect(strip(editor.sheet)).toHaveClass(/select-text/)
      await discard(page, editor)
    })

    await test.step('switching the window\'s type re-seeds the value to the new default', async () => {
      const editor = await openComplex(page, 'tbl11', 'table')
      await setValueEditorView(page, editor.sheet, 'Code')
      await replaceValueEditorCode(page, editor.sheet, '[{"a": 1}]')
      await saveValueEditor(editor.sheet)
      await closeValueEditor(page, editor.sheet)
      await expect(valueField(editor.win).locator('input')).toHaveValue('[{"a": 1}]')
      // VMGR-108: table -> map with a non-empty value fires the destructive confirm first.
      await setCreateType(page, 'map', editor.win)
      const confirm = page.getByRole('alertdialog').filter({ hasText: 'Change variable type?' })
      // Soft, so the steps after this one still run when the confirm is missing.
      await expect.soft(confirm, 'a table holding a row asks before its type changes').toBeVisible()
      if (await confirm.isVisible()) await answerChangeConfirm(page, 'Change type')
      await expect(valueField(editor.win).locator('input')).toHaveValue('{}')
      const sheet = await openValueEditor(page, editor.win)
      await setValueEditorView(page, sheet, 'Code')
      await expect(valueEditorCode(sheet)).toHaveText('{}')
      await closeValueEditor(page, sheet)
      await cancelCreate(page, editor.win)
    })

    await test.step('a Code array error names the offending number\'s line, not the slot opening line', async () => {
      const editor = await openComplex(page, 'arr4', 'array')
      await setValueEditorView(page, editor.sheet, 'Code')
      // Index 1 is a nested array opening on line 3; its bad float is on line 5.
      await replaceValueEditorCode(page, editor.sheet, `[\n  1,\n  [\n    10,\n    1.${'2'.repeat(30)}\n  ]\n]`)
      await expect(strip(editor.sheet)).toContainText('Index 1: nested float exceeds 28 significant digits')
      await expect(strip(editor.sheet)).toContainText('Line 5:')
      await discard(page, editor)
    })
  })
})
