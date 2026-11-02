/**
 * V-NUMBER-BLOCKS-EDITORS-FUNCTIONAL: the editors keep every digit a number is written with
 * Wireframe: none (functional)
 * Design Decisions: VMGR-110, FIELD-11
 * REQ: REQ-3.1.3.14, REQ-3.1.3.11
 *
 * `fixture-blocks-editors.json`: a JSON Parser whose JSON content is `{"id": 12345678901234567890}` with the query
 * `id` = `$.id`, and a list variable `huge` holding the number 1e21.
 *
 * Pass Criteria:
 * 1. The Format button of a JSON string value keeps `12345678901234567890` and `1.50` exactly as written.
 * 2. The Format button of a YAML string value (the text variable `doc`) keeps them too.
 * 3. The JSON Parser JSONPath Test on `$.id` shows `12345678901234567890`, every digit.
 * 4. The read Code view of the list holding 1e21 shows `1000000000000000000000`, never `1e+21`.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { readFixture } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTestQuietly, discardSheet, nodeIdOf } from '../../helpers/number-rule'
import {
  cancelCreate,
  closeValueEditor,
  expandVariableManager,
  formatValueEditor,
  openEditWindow,
  openValueEditor,
  replaceValueEditorCode,
  setValueEditorFormat,
  valueEditorCode,
  variableRow,
} from '../../helpers/variable-create'
import { openBlockSheet } from '../../helpers/workbench'

const BIG = '12345678901234567890'

test.describe('V-NUMBER-BLOCKS-EDITORS-FUNCTIONAL: editors keep every digit', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await deleteTestQuietly(request, testId)
  })

  test('Format, the JSONPath Test and the read Code view keep the digits as written', async ({ page }) => {
    test.setTimeout(180_000)
    const fixture = readFixture(__dirname, 'fixture-blocks-editors.json')
    const parser = nodeIdOf(fixture, 'Big Digits')
    testId = await importValidateAndNavigate(page, fixture, { rejectRepairs: true })

    const sheet = await openBlockSheet(page, parser)

    await test.step('the JSONPath Test shows the 20-digit id with every digit', async () => {
      await sheet.locator('[data-testid="json-query-test-0"]').click()
      const result = page.getByRole('dialog').filter({ hasText: 'JSONPath evaluation result' })
      await expect(result).toBeVisible()
      await expect(result).toContainText(BIG)
      await expect(result).not.toContainText('12345678901234567000')
      await page.keyboard.press('Escape')
      await expect(result).toBeHidden()
    })

    await test.step('Format keeps the digits of a JSON string value', async () => {
      await sheet.locator('[data-testid="param-expand-json_content"]').click()
      const editor = page.locator('[data-testid="value-editor-sheet"]')
      await expect(editor).toBeVisible()
      await expect(editor.locator('[data-testid="format-dropdown"]'), 'JSON Content is JSON text').toHaveText('JSON')
      await replaceValueEditorCode(page, editor, `{"id":${BIG},"rate":1.50}`)
      await formatValueEditor(editor)
      await expect(valueEditorCode(editor).locator('.cm-line')).toHaveText(['{', `  "id": ${BIG},`, '  "rate": 1.50', '}'])
      await closeValueEditor(page, editor, 'Close')
      await discardSheet(page, sheet)
    })

    await test.step('Format keeps the digits of a YAML string value', async () => {
      const win = await openEditWindow(page, 'doc')
      const editor = await openValueEditor(page, win)
      await setValueEditorFormat(page, editor, 'YAML')
      await replaceValueEditorCode(page, editor, `{id: ${BIG}, rate: 1.50}`)
      await formatValueEditor(editor)
      await expect(valueEditorCode(editor).locator('.cm-line')).toHaveText([`id: ${BIG}`, 'rate: 1.50'])
      await closeValueEditor(page, editor, 'Close')
      await cancelCreate(page, win)
    })

    await test.step('the read Code view of a list holding 1e21 writes it in plain digits', async () => {
      await expandVariableManager(page)
      const row = variableRow(page, 'huge')
      await row.hover()
      await row.locator('[data-testid^="expand-button-"]').click()
      const watcher = page.locator('section[aria-label="Inspect variable huge"]')
      await expect(watcher).toBeVisible()
      await watcher.locator('[data-testid="view-dropdown"]').click()
      await page.getByRole('option', { name: 'Code', exact: true }).click()
      const code = watcher.locator('[data-testid="code-body"] .cm-content')
      await expect(code).toContainText('1000000000000000000000')
      await expect(code).not.toContainText('e+21')
    })
  })
})
