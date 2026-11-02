/**
 * V-FN-LOCAL-ELEMENT-TYPES: inside a local Function, a map variable and a list input's
 * default keep the type picked for every element - saved in the Function's definition,
 * read back after a reload, and realized in the body at run time.
 * REQ: REQ-3.1.3.19, REQ-3.1.2.1, REQ-3.1.3.11
 *
 * Pass Criteria:
 * 1. Drilled into the Function, the Edit window's "Edit value" sheet offers and keeps every
 *    element type for the map variable `fm` and the list input `fa`.
 * 2. The saved definition stores the exact text with each element's declared type
 *    (GET /tests/{id}): on the variable beside `value`, on the input beside `default`.
 * 3. After a reload the drilled Edit windows' sheets read every row back with its type.
 * 4. A run seeds the body with every element as its declared type (the body's probes).
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { openTest } from '../../helpers/fn-seed'
import {
  cancelWindow,
  closeValueEditor,
  editWindow,
  expandVariableManager,
  openEditWindow,
  openValueEditor,
  saveValueEditor,
  saveWindow,
  setValueEditorView,
} from '../../helpers/variable-create'
import { digIn, popToBreadcrumbSegment, saveBtn, selectEnvironment } from '../../helpers/workbench'
import {
  LIST_ROWS,
  MAP_ROWS,
  deleteTest,
  expectListRows,
  expectMapRows,
  expectProbeLines,
  fillListRows,
  fillMapRows,
  getTest,
  importValidated,
  listElementTypes,
  listProbe,
  listProbeLine,
  mapElementTypes,
  mapProbe,
  mapProbeLine,
  readFixture,
  settleRun,
  storedList,
  storedMap,
  substitute,
  valueSheet,
} from '../../helpers/element-types'

const FN_NODE = '3078107d-10cd-418f-a92c-17e89090774e'

/** The pencil's Edit window with its value open in the "Edit value" sheet's Visual view. */
async function openEditor(page: Page, name: string): Promise<Locator> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  await setValueEditorView(page, sheet, 'Visual')
  return sheet
}

/** Save: apply the sheet and save the window. Cancel: close the sheet and the window unchanged. */
async function closeEditor(page: Page, name: string, action: 'save' | 'cancel'): Promise<void> {
  const sheet = valueSheet(page)
  const win = await editWindow(page, name)
  if (action === 'save') {
    await saveValueEditor(sheet)
    await closeValueEditor(page, sheet)
    await saveWindow(page, win)
    return
  }
  await closeValueEditor(page, sheet)
  await cancelWindow(page, win)
}

test.describe('V-FN-LOCAL-ELEMENT-TYPES: Function-scope element types', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('a Function map variable and list input default keep every element type', async ({ page, request }) => {
    test.setTimeout(240_000)
    const fixture = substitute(readFixture(__dirname, 'element-types-fixture.json'), {
      __MAP_PROBE__: mapProbe('FNMAP', 'fm'),
      __LIST_PROBE__: listProbe('FNLIST', 'fa'),
    })
    testId = await importValidated(request, fixture)
    const testName = (await getTest(request, testId)).name as string
    await openTest(page, testId)

    await test.step('drilled in, type the variable and input rows and save', async () => {
      await digIn(page, FN_NODE)
      await expandVariableManager(page)
      await fillMapRows(page, await openEditor(page, 'fm'), MAP_ROWS)
      await closeEditor(page, 'fm', 'save')
      await fillListRows(page, await openEditor(page, 'fa'), LIST_ROWS)
      await closeEditor(page, 'fa', 'save')
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
    })

    await test.step('the saved definition carries each element type', async () => {
      const stored = await getTest(request, testId)
      const node = (stored.workflow.nodes as Array<Record<string, any>>).find((entry) => entry.id === FN_NODE)
      const definition = node?.data.localDefinition
      const variable = definition.variables.find((entry: Record<string, unknown>) => entry.name === 'fm')
      expect(variable.value).toEqual(storedMap())
      expect(variable.elementTypes).toEqual(mapElementTypes())
      const input = definition.inputs.find((entry: Record<string, unknown>) => entry.name === 'fa')
      expect(input.default).toEqual(storedList())
      expect(input.elementTypes).toEqual(listElementTypes())
    })

    await test.step('after a reload the drilled editors read every type back', async () => {
      await openTest(page, testId)
      await digIn(page, FN_NODE)
      await expandVariableManager(page)
      await expectMapRows(await openEditor(page, 'fm'), MAP_ROWS)
      await closeEditor(page, 'fm', 'cancel')
      await expectListRows(await openEditor(page, 'fa'), LIST_ROWS)
      await closeEditor(page, 'fa', 'cancel')
      await popToBreadcrumbSegment(page, testName)
    })

    await test.step('the body reads every element as its declared type', async () => {
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [mapProbeLine('FNMAP'), listProbeLine('FNLIST')])
    })
  })
})
