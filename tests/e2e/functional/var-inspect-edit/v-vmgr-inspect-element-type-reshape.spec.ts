/**
 * V-VMGR-INSPECT-ELEMENT-TYPE-RESHAPE: reshaping a typed map and list in the "Edit value" window
 * keeps every element's declared type attached to its own value.
 * Design Decisions: VMGR-82, VMGR-110
 * REQ: REQ-3.1.3.19, REQ-3.1.3.11
 *
 * Pass Criteria:
 * 1. Map: a renamed key keeps its type, a removed row takes its type with it, digits typed
 *    into a new row stay text, and a decimal typed into a whole-number row never enters it:
 *    the row keeps its number.
 * 2. List: a moved item carries its type, a removed item takes its type with it, and a type
 *    picked after a new item's text asks `Change item type?`, clears the text to the type's
 *    default, and the number typed again keeps the picked type.
 * 3. A trip through the Code view and back keeps every row's type; the Code view writes
 *    numbers bare and text quoted.
 * 4. The saved Test stores each value with its own type (GET /tests/{id}), and a reload
 *    reads every row back with its type.
 * 5. The run reads every element as its declared type: whole numbers add (19 digits
 *    exactly), floats double exactly, text concatenates, nested leaves stay numbers.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { openTest } from '../../helpers/fn-seed'
import {
  cancelWindow,
  closeValueEditor,
  expandVariableManager,
  openEditWindow,
  openValueEditor,
  saveValueEditor,
  saveWindow,
  setValueEditorView,
  valueEditorCode,
} from '../../helpers/variable-create'
import { saveTest, selectEnvironment } from '../../helpers/workbench'
import {
  BIG_INT,
  BIG_INT_PLUS_ONE,
  deleteTest,
  expectListRows,
  expectMapRows,
  expectProbeLines,
  getTest,
  importValidated,
  readFixture,
  settleRun,
  type ListRow,
  type MapRow,
} from '../../helpers/element-types'

const MAP_AFTER: readonly MapRow[] = [
  { key: 'count', text: '16', type: 'integer' },
  { key: 'f', text: '2.50', type: 'float' },
  { key: 'big', text: BIG_INT, type: 'integer' },
  { key: 'z2', text: '007', type: 'string' },
]

const LIST_AFTER: readonly ListRow[] = [
  { text: '2.5', type: 'float' },
  { text: '02134', type: 'string' },
  { text: '[1, 2.5]', type: 'array' },
  { text: '42', type: 'integer' },
]

/** The variable's Edit window and its "Edit value" sheet, opened on the Visual view. */
async function openSheet(page: Page, name: string): Promise<{ win: Locator; sheet: Locator }> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  await setValueEditorView(page, sheet, 'Visual')
  return { win, sheet }
}

/** Apply the sheet to the window, close the sheet, and save the window. */
async function applyAndSave(page: Page, win: Locator, sheet: Locator): Promise<void> {
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await saveWindow(page, win)
}

test.describe('V-VMGR-INSPECT-ELEMENT-TYPE-RESHAPE: reshaped rows keep their own types', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('rename, remove, add, move and a Code trip keep each type on its value', async ({ page, request }) => {
    test.setTimeout(180_000)
    testId = await importValidated(request, readFixture(__dirname, 'element-types-reshape-fixture.json'))
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('map: rename, remove, a refused decimal, a digits-only new row', async () => {
      const { win, sheet } = await openSheet(page, 'm')
      await expectMapRows(sheet, [
        { key: 'n', text: '16', type: 'integer' },
        { key: 'f', text: '1.0', type: 'float' },
        { key: 'zip', text: '02134', type: 'string' },
        { key: 'big', text: BIG_INT, type: 'integer' },
      ])
      await sheet.locator('[data-testid="map-edit-key-0"]').fill('count')
      await sheet.locator('[data-testid="map-remove-2"]').click()
      const count = sheet.locator('[data-testid="map-edit-value-0"]')
      // A whole-number row takes no decimal point: the keystroke is dropped (REQ-3.1.3.14).
      await count.fill('1.5')
      await expect(count, 'a decimal never enters a whole-number row').toHaveValue('16')
      await expect(sheet.locator('[data-testid="map-type-0"]')).toHaveText('integer')
      await expect(count).not.toHaveAttribute('aria-invalid', 'true')
      await sheet.locator('[data-testid="map-edit-value-1"]').fill('2.50')
      await sheet.locator('[data-testid="map-add-entry"]').click()
      await sheet.locator('[data-testid="map-edit-key-3"]').fill('z2')
      await sheet.locator('[data-testid="map-edit-value-3"]').fill('007')
      await expect(sheet.locator('[data-testid="map-type-3"]'), 'digits never pick a number').toHaveText('string')
      await expectMapRows(sheet, MAP_AFTER)

      await setValueEditorView(page, sheet, 'Code')
      const code = valueEditorCode(sheet)
      await expect(code).toContainText('"count": 16')
      await expect(code).toContainText('"f": 2.50')
      await expect(code).toContainText(`"big": ${BIG_INT}`)
      await expect(code).toContainText('"z2": "007"')
      await setValueEditorView(page, sheet, 'Visual')
      await expectMapRows(sheet, MAP_AFTER)
      await applyAndSave(page, win, sheet)
    })

    await test.step('list: move, remove, a type picked after the text asks first, a Code trip', async () => {
      const { win, sheet } = await openSheet(page, 'a')
      await expectListRows(sheet, [
        { text: '16', type: 'integer' },
        { text: '02134', type: 'string' },
        { text: '2.5', type: 'float' },
        { text: '[1, 2.5]', type: 'array' },
      ])
      await sheet.locator('[data-testid="array-move-up-2"]').click()
      await sheet.locator('[data-testid="array-remove-0"]').click()
      await sheet.locator('[data-testid="array-add-item"]').click()
      await sheet.locator('[data-testid="array-edit-input-3"]').fill('42')
      await expect(sheet.locator('[data-testid="array-type-3"]'), 'digits never pick a number').toHaveText('string')
      const pill = sheet.locator('[data-testid="array-type-3"]')
      await pill.click()
      await page.getByRole('option', { name: 'integer', exact: true }).click()
      const ask = page.getByRole('alertdialog').filter({ hasText: 'Change item type?' })
      await expect(ask).toContainText('Changing type to integer will clear 1 existing string value. This cannot be undone.')
      await ask.getByRole('button', { name: 'Change type', exact: true }).click()
      await expect(pill).toHaveText('integer')
      const typed = sheet.locator('[data-testid="array-edit-input-3"]')
      await expect(typed, 'the type change leaves the type default').toHaveValue('0')
      await typed.fill('42')
      await expectListRows(sheet, LIST_AFTER)

      await setValueEditorView(page, sheet, 'Code')
      const code = valueEditorCode(sheet)
      await expect(code).toContainText('"02134"')
      await expect(code).toContainText('42')
      await setValueEditorView(page, sheet, 'Visual')
      await expectListRows(sheet, LIST_AFTER)
      await applyAndSave(page, win, sheet)
    })

    await test.step('the saved Test keeps each value with its own type', async () => {
      await saveTest(page)
      const stored = await getTest(request, testId)
      expect(stored.variables.m.value).toEqual({ count: '16', f: '2.50', big: BIG_INT, z2: '007' })
      expect(stored.variables.m.elementTypes).toEqual({
        count: 'integer',
        f: 'float',
        big: 'integer',
        z2: 'string',
      })
      expect(stored.variables.a.value).toEqual(['2.5', '02134', '[1, 2.5]', '42'])
      expect(stored.variables.a.elementTypes).toEqual(['float', 'string', 'array', 'integer'])
    })

    await test.step('after a reload every row reads back with its type', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      for (const [name, check] of [
        ['m', (sheet: Locator) => expectMapRows(sheet, MAP_AFTER)],
        ['a', (sheet: Locator) => expectListRows(sheet, LIST_AFTER)],
      ] as const) {
        const { win, sheet } = await openSheet(page, name)
        await check(sheet)
        await closeValueEditor(page, sheet)
        await cancelWindow(page, win)
      }
    })

    await test.step('the run reads every element as its declared type', async () => {
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [
        `RESHAPE count=17 f=5.00 big=${BIG_INT_PLUS_ONE} z2=007x keys=count,f,big,z2 ` +
          'a0=5.0 a1=02134-x a2=5.0 a3=43 n=4',
      ])
    })
  })
})
