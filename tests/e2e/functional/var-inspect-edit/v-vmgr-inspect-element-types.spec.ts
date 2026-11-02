/**
 * V-VMGR-INSPECT-ELEMENT-TYPES: changing an element's declared type in the "Edit value" window
 * is a real edit - it saves, reads back after a reload, and changes the run.
 * Design Decisions: VMGR-82, VMGR-110
 * REQ: REQ-3.1.3.19, REQ-3.1.3.11
 *
 * The fixture's map was saved with no element types, so each entry reads by its stored
 * shape: the text `16` is text. Declaring it a whole number asks first, clears it to the
 * type's default, and the number is typed again.
 *
 * Pass Criteria:
 * 1. An entry saved without a declared type opens as text (its stored shape), and the
 *    numeric-looking zip code opens as text too.
 * 2. Picking integer for `n` asks `Change entry type?` with `Changing type to integer will
 *    clear 1 existing string value. This cannot be undone.`; Change type leaves `0`, and `16`
 *    typed again is a change the window saves.
 * 3. The saved Test declares `n` integer and `zip` string (GET /tests/{id}).
 * 4. After a reload `n` reads back as integer and `zip` as string.
 * 5. At run time `m['n'] + 1` is 17 and `m['zip'] + '-x'` is `02134-x`.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
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
} from '../../helpers/variable-create'
import { saveTest, selectEnvironment } from '../../helpers/workbench'
import {
  deleteTest,
  expectMapRows,
  expectProbeLines,
  getTest,
  importValidated,
  readFixture,
  settleRun,
} from '../../helpers/element-types'

test.describe('V-VMGR-INSPECT-ELEMENT-TYPES: a type change is saved', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('declaring an entry a whole number saves, reloads and runs', async ({ page, request }) => {
    test.setTimeout(180_000)
    testId = await importValidated(request, readFixture(__dirname, 'element-types-fixture.json'))
    await openTest(page, testId)
    await expandVariableManager(page)

    await test.step('the undeclared entries open as text; picking integer asks, clears and is a change the window saves', async () => {
      const win = await openEditWindow(page, 'm')
      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Visual')
      await expectMapRows(sheet, [
        { key: 'n', text: '16', type: 'string' },
        { key: 'zip', text: '02134', type: 'string' },
      ])
      const pill = sheet.locator('[data-testid="map-type-0"]')
      await pill.click()
      await page.getByRole('option', { name: 'integer', exact: true }).click()
      const ask = page.getByRole('alertdialog').filter({ hasText: 'Change entry type?' })
      await expect(ask).toContainText(
        'Changing type to integer will clear 1 existing string value. This cannot be undone.',
      )
      await ask.getByRole('button', { name: 'Change type', exact: true }).click()
      await expect(ask).toHaveCount(0)
      await expect(pill).toHaveText('integer')
      const value = sheet.locator('[data-testid="map-edit-value-0"]')
      await expect(value, 'the type change leaves the type default').toHaveValue('0')
      await value.fill('16')
      await saveValueEditor(sheet)
      await closeValueEditor(page, sheet)
      await saveWindow(page, win)
      await saveTest(page)
    })

    await test.step('the saved Test declares the picked types', async () => {
      const stored = await getTest(request, testId)
      expect(stored.variables.m.value).toEqual({ n: '16', zip: '02134' })
      expect(stored.variables.m.elementTypes).toEqual({ n: 'integer', zip: 'string' })
    })

    await test.step('after a reload the picked types read back', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      const win = await openEditWindow(page, 'm')
      const sheet = await openValueEditor(page, win)
      await setValueEditorView(page, sheet, 'Visual')
      await expectMapRows(sheet, [
        { key: 'n', text: '16', type: 'integer' },
        { key: 'zip', text: '02134', type: 'string' },
      ])
      await closeValueEditor(page, sheet)
      await cancelWindow(page, win)
    })

    await test.step('the run adds to the whole number and appends to the text', async () => {
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), ['EDIT n=17 zip=02134-x'])
    })
  })
})
