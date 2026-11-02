/**
 * V-VARSET-ELEMENT-TYPES: a Variable Setter's map and list rows keep the type picked for
 * every element - in the saved node, after a reload, and in the values the run assigns.
 * Design Decisions: VMGR-85 (the setter's complex value editor)
 * REQ: REQ-3.1.3.19, REQ-3.4.1.14
 *
 * Pass Criteria:
 * 1. The setter's value sheet offers and keeps every element type for a map row and a
 *    list row.
 * 2. The saved node stores the rows' exact text and each row's element types
 *    (GET /tests/{id}/workflow).
 * 3. After a reload the setter's value sheets show every row with its declared type.
 * 4. The run assigns every element as its declared type (the probe Logs).
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { openTest } from '../../helpers/fn-seed'
import { configSheet, saveBtn, selectEnvironment } from '../../helpers/workbench'
import {
  LIST_ROWS,
  MAP_ROWS,
  deleteTest,
  expectListRows,
  expectMapRows,
  expectProbeLines,
  fillListRows,
  fillMapRows,
  getNode,
  importValidated,
  listElementTypes,
  listProbe,
  listProbeLine,
  mapElementTypes,
  mapProbe,
  mapProbeLine,
  readFixture,
  saveAndCloseSheet,
  settleRun,
  storedList,
  storedMap,
  substitute,
  valueSheet,
} from '../../helpers/element-types'

const SETTER = '32df9c58-c020-4066-a204-ae25960ac87a'

async function openSetter(page: Page) {
  await page.locator(`[data-testid="workflow-node-${SETTER}"]`).locator('button').first().dblclick()
  const dialog = configSheet(page)
  await expect(dialog).toBeVisible({ timeout: 10_000 })
  return dialog
}

test.describe('V-VARSET-ELEMENT-TYPES: Variable Setter element types', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('map and list rows keep every element type into the run', async ({ page, request }) => {
    test.setTimeout(240_000)
    const fixture = substitute(readFixture(__dirname, 'element-types-fixture.json'), {
      __MAP_PROBE__: mapProbe('SETMAP', 'm'),
      __LIST_PROBE__: listProbe('SETLIST', 'a'),
    })
    testId = await importValidated(request, fixture)
    await openTest(page, testId)

    await test.step('type the map and list rows in the setter sheets and save', async () => {
      const dialog = await openSetter(page)
      await dialog.locator('[data-testid="varset-edit-value-0"]').click()
      await fillMapRows(page, valueSheet(page), MAP_ROWS)
      await saveAndCloseSheet(page)
      await dialog.locator('[data-testid="varset-edit-value-1"]').click()
      await fillListRows(page, valueSheet(page), LIST_ROWS)
      await saveAndCloseSheet(page)
      await dialog.getByRole('button', { name: /^Save$/ }).last().click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
    })

    await test.step('the saved node carries the rows and their element types', async () => {
      const node = await getNode(request, testId, SETTER)
      expect(node.data.config.values.variables).toEqual({ m: storedMap(), a: storedList() })
      expect(node.data.variableElementTypes).toEqual({ m: mapElementTypes(), a: listElementTypes() })
    })

    await test.step('after a reload the setter sheets read every type back', async () => {
      await openTest(page, testId)
      const dialog = await openSetter(page)
      await dialog.locator('[data-testid="varset-edit-value-0"]').click()
      await expectMapRows(valueSheet(page), MAP_ROWS)
      await valueSheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
      await dialog.locator('[data-testid="varset-edit-value-1"]').click()
      await expectListRows(valueSheet(page), LIST_ROWS)
      await valueSheet(page).locator('[data-testid="value-editor-cancel-button"]').click()
      await expect(valueSheet(page)).toBeHidden()
      await dialog.getByRole('button', { name: /^Cancel$/ }).last().click()
      await expect(dialog).toBeHidden({ timeout: 10_000 })
    })

    await test.step('the run assigns every element as its declared type', async () => {
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [mapProbeLine('SETMAP'), listProbeLine('SETLIST')])
    })
  })
})
