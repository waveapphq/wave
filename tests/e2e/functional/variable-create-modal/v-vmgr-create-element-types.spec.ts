/**
 * V-VMGR-CREATE-ELEMENT-TYPES: a map and a list created in the Variable Manager keep
 * the type picked for every element - through save, a reload and a run.
 * Design Decisions: VMGR-82 (Key / Value / Type rows), VMGR-106, VMGR-110
 * REQ: REQ-3.1.3.19, REQ-3.1.3.14, REQ-3.1.3.11
 *
 * Pass Criteria:
 * 1. Every element type is offered and picked in the New variable window's "Edit value"
 *    window: integer, float, boolean, string, list and map.
 * 2. The saved Test stores each variable's value with numbers as their exact text and a
 *    sidecar naming each element's declared type (GET /tests/{id}).
 * 3. After a reload the Edit window's "Edit value" window shows every row with the type
 *    picked for it.
 * 4. At run time each element is the type it was declared: `m['n'] + 1` is 17, the
 *    19-digit integer adds exactly, `1.0 * 2` is 2.0, a 28-digit float keeps its digits,
 *    a boolean negates, and the numeric-looking text (zip code 02134, version 1.10,
 *    bracketed text) stays text. Nested list / map leaves keep their JSON types.
 *
 * Phase: functional-workflow (creates its own Test, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { openTest, validateTest } from '../../helpers/fn-seed'
import {
  cancelWindow,
  closeValueEditor,
  createModal,
  expandVariableManager,
  openCreateModal,
  openEditWindow,
  openValueEditor,
  saveValueEditor,
  setCreateName,
  setCreateType,
  submitCreate,
} from '../../helpers/variable-create'
import { saveBtn, selectEnvironment } from '../../helpers/workbench'
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
} from '../../helpers/element-types'

async function toolbarSave(page: Page): Promise<void> {
  await expect(saveBtn(page)).toBeEnabled()
  await saveBtn(page).click()
  await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
}

/** Create `name` of `type`, typing its rows in the "Edit value" window. */
async function createTyped(
  page: Page,
  name: string,
  type: 'map' | 'array',
  fill: (sheet: Locator) => Promise<void>,
): Promise<void> {
  const win = await openCreateModal(page)
  await setCreateName(page, name, win)
  await setCreateType(page, type, win)
  const sheet = await openValueEditor(page, win)
  await fill(sheet)
  await saveValueEditor(sheet)
  await closeValueEditor(page, sheet)
  await submitCreate(page, win)
  await expect(win).toBeHidden()
}

/** Open a variable's Edit window and its "Edit value" window. */
async function openRows(page: Page, name: string): Promise<{ win: Locator; sheet: Locator }> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  return { win, sheet }
}

test.describe('V-VMGR-CREATE-ELEMENT-TYPES: declared element types survive create, save, reload and a run', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    if (testId) await deleteTest(request, testId)
  })

  test('a map and a list keep every element type', async ({ page, request }) => {
    test.setTimeout(300_000)
    testId = await importValidated(request, {
      name: 'V-VMGR-CREATE-ELEMENT-TYPES',
      version: '1.0.0',
      description: 'Variables created through the modal, probed after they exist',
      workflow: { nodes: [], edges: [] },
      variables: {},
      metadata: {},
    })
    await openTest(page, testId)

    await test.step('create a map and a list, picking a type on every row', async () => {
      await createTyped(page, 'm', 'map', (sheet) => fillMapRows(page, sheet, MAP_ROWS))
      await createTyped(page, 'a', 'array', (sheet) => fillListRows(page, sheet, LIST_ROWS))
      await expect(createModal(page)).toHaveCount(0)
      await toolbarSave(page)
    })

    await test.step('the saved Test stores exact text and every declared element type', async () => {
      const stored = await getTest(request, testId)
      expect(stored.variables.m.value).toEqual(storedMap())
      expect(stored.variables.m.elementTypes, 'map element types are saved').toEqual(mapElementTypes())
      expect(stored.variables.a.value).toEqual(storedList())
      expect(stored.variables.a.elementTypes, 'list element types are saved').toEqual(listElementTypes())
    })

    await test.step('after a reload every row reads back with its type', async () => {
      await openTest(page, testId)
      await expandVariableManager(page)
      const map = await openRows(page, 'm')
      await expectMapRows(map.sheet, MAP_ROWS)
      await closeValueEditor(page, map.sheet)
      await cancelWindow(page, map.win)

      const list = await openRows(page, 'a')
      await expectListRows(list.sheet, LIST_ROWS)
      await closeValueEditor(page, list.sheet)
      await cancelWindow(page, list.win)
    })

    await test.step('a run reads every element as its declared type', async () => {
      const probe = substitute(readFixture(__dirname, 'element-types-probe.json'), {
        __MAP_PROBE__: mapProbe('MAP', 'm'),
        __LIST_PROBE__: listProbe('LIST', 'a'),
      })
      const put = await request.put(`${BACKEND_URL}/tests/${testId}`, { data: { workflow: probe.workflow } })
      expect(put.ok(), `PUT /tests/${testId}: ${put.status()} ${await put.text()}`).toBeTruthy()
      const validation = await validateTest(request, testId)
      expect(validation.errors, JSON.stringify(validation.errors)).toEqual([])

      await openTest(page, testId)
      await selectEnvironment(page)
      await page.locator('[data-testid="run-button"]').click()
      expectProbeLines(await settleRun(page), [mapProbeLine('MAP'), listProbeLine('LIST')])
    })
  })
})
