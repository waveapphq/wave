/**
 * V-ENTRY-BEHAVIOR-NESTED-FUNCTIONAL: a List or Map entry opens the Edit value editor one level deeper.
 * Design Decisions: FIELD-6, FIELD-13, VMGR-110
 * REQ: REQ-3.1.3.19, REQ-3.1.3.11
 *
 * Pass Criteria:
 * 1. A Map entry's expand opens a second `Edit value` sheet one level deeper, placed 24 px right and down of the
 *    level it was opened from.
 * 2. Close on a changed nested level discards it (after its unsaved-changes question); the entry below keeps its
 *    value and the first level has nothing to save.
 * 3. A nested Save writes into the entry below only; the field changes only with the first level's Save, and the
 *    saved Test holds the new nested value.
 * 4. At the tenth level the List and Map expands are disabled (visually disabled) with the tooltip
 *    `Up to 10 nested levels`; the text expand stays on, and every level below opens the next.
 * 5. A read-only sheet (a library Function View) opens a nested level read-only: no field takes a change.
 * 6. New variable > Map > expand > Add entry > Map > expand: the nested entry offers all six types; picking Map
 *    again opens an editable third level.
 * 7. A whole Float `3.0` and an Integer `3` saved at the third level are stored as written and reopen as
 *    `3.0` (float) and `3` (integer).
 * 8. A List or Map entry reads as one spaced JSON line (`{"a": "x"}`) when the editor opens and after a
 *    nested Save, at every level.
 *
 * Phase: functional-workflow (imports its own fixture and seeds its own library Function, deletes both after).
 */

import { randomUUID } from 'node:crypto'

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, getTest, readFixture } from '../../helpers/element-types'
import { localFunctionNode, logNode, openFunctionView, openTest, publishLibraryFunction, startEdge } from '../../helpers/fn-seed'
import { openBlockSheet, saveTest } from '../../helpers/workbench'
import {
  closeValueEditor,
  openCreateModal,
  openEditWindow,
  openValueEditor,
  saveValueEditor,
  saveWindow,
  setCreateName,
  setCreateType,
  setValueEditorView,
  submitCreate,
} from '../../helpers/variable-create'
import {
  expectVisuallyDisabled,
  mapEntry,
  type EntryParts,
  openBlockEditor,
  openNestedEditor,
  openVariableEditor,
  parkPointer,
  rectOf,
  valueSheets,
} from '../../helpers/entry-editors'
import { waitForTooltipText } from '../../helpers/tooltip-wait'
import {
  deleteLibraryFunction,
  NESTED_LIMIT_NOTE,
  pickEntryTypeAtOnce,
  SIX_TYPES,
  structureOf,
  typeOptions,
  windowLine,
} from '../../helpers/entry-behavior'
import { BACKEND_URL } from '../../helpers/config'

const FIXTURE = 'fixture-behavior-nested.json'
const NEW_MAP = 'zz_11541_s6b_nested'
const MAP_FN = '46d0a5ce-1841-4956-aeaf-15d1adb5ba03'
const MAP_FN_BODY = 'e2dc9d29-9efc-4bc9-ba9f-39e9e2ec5f96'
const LEVEL_STEP_PX = 24
const THIRD_LEVEL_TEXT = '{"n": 3, "f": 3.0}'
const SECOND_LEVEL_TEXT = `{"inner": ${THIRD_LEVEL_TEXT}}`

/** The sheet's Save button. */
const sheetSave = (sheet: Locator): Locator => sheet.locator('[data-testid="value-editor-save-button"]')

/** `next` sits one cascade step right and down of `previous`. */
async function expectStepped(previous: Locator, next: Locator): Promise<void> {
  const from = await rectOf(previous, 'the level opened from')
  const to = await rectOf(next, 'the nested level')
  expect(to.x - from.x, 'the nested level opens to the right').toBeCloseTo(LEVEL_STEP_PX, 0)
  expect(to.y - from.y, 'the nested level opens lower').toBeCloseTo(LEVEL_STEP_PX, 0)
}

/** Add a map entry `key` of `type` to the map editor in `sheet` and return its parts. */
async function addEntry(
  page: Page,
  sheet: Locator,
  index: number,
  key: string,
  type: 'integer' | 'float' | 'map',
): Promise<EntryParts> {
  await sheet.locator('[data-testid="map-add-entry"]').click()
  const entry = mapEntry(sheet, index)
  await entry.keyInput.fill(key)
  await pickEntryTypeAtOnce(page, entry.typeCell, type)
  return entry
}

test.describe('V-ENTRY-BEHAVIOR-NESTED-FUNCTIONAL: nested Edit value levels', () => {
  let testId = ''

  test.beforeEach(async ({ page }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('a nested Save writes the entry below, Close discards, and only the first level writes the field', async ({
    page,
  }) => {
    const win = await openEditWindow(page, 'nest')
    await expect(windowLine(win)).toHaveValue(/"a": "x"/)
    const first = await openValueEditor(page, win)
    await setValueEditorView(page, first, 'Visual')
    const inner = mapEntry(first, 0)
    await expect(inner.keyInput).toHaveValue('inner')
    await expect(inner.typeCell).toHaveText('map')
    await expect(inner.valueInput, 'a stored Map entry reads as one spaced JSON line').toHaveValue('{"a": "x"}')

    await test.step('the Map entry opens a second Edit value sheet one level deeper, stepped off the first', async () => {
      const second = await openNestedEditor(page, inner.expand)
      await expect(valueSheets(page)).toHaveCount(2)
      await expect(second.locator('[data-testid="value-editor-type-badge"]')).toHaveText('map')
      await expect(mapEntry(second, 0).keyInput).toHaveValue('a')
      await expectStepped(first, second)

      await mapEntry(second, 0).valueInput.fill('y')
      await closeValueEditor(page, second, 'Close')
      await expect(inner.valueInput, 'Close discards the nested change').toHaveValue('{"a": "x"}')
      await expect(sheetSave(first), 'the first level has nothing to save').toBeDisabled()
    })

    await test.step('a nested Save writes the entry below; the field waits for the first level', async () => {
      const second = await openNestedEditor(page, inner.expand)
      await expect(mapEntry(second, 0).valueInput, 'the discarded change is gone').toHaveValue('x')
      await mapEntry(second, 0).valueInput.fill('y')
      await saveValueEditor(second)
      await closeValueEditor(page, second)
      await expect(inner.valueInput, 'the nested Save wrote the entry below').toHaveValue('{"a": "y"}')
      await expect(windowLine(win), 'the field is not written yet').toHaveValue(/"a": "x"/)

      await saveValueEditor(first)
      await expect(windowLine(win), 'the first level Save writes the field').toHaveValue(/"a": "y"/)
      await closeValueEditor(page, first)
    })

    await test.step('the saved Test holds the nested value', async () => {
      await saveWindow(page, win)
      await saveTest(page)
      const nest = (await getTest(page.request, testId)).variables.nest
      expect(nest.type).toBe('map')
      expect(nest.elementTypes).toEqual({ inner: 'map', tag: 'string' })
      expect({ ...nest.value, inner: structureOf(nest.value.inner) }).toEqual({ inner: { a: 'y' }, tag: 't' })
    })
  })

  test('the tenth level disables the List and Map expand with the limit tooltip', async ({ page }) => {
    let level = await openVariableEditor(page, 'deep')

    await test.step('each level up to the ninth opens the next from its Map entry', async () => {
      for (let next = 2; next <= 10; next++) {
        const entry = mapEntry(level, 0)
        await expect(entry.keyInput).toHaveValue(`l${next}`)
        await expect(entry.expand, `level ${next - 1} opens level ${next}`).toBeEnabled()
        level = await openNestedEditor(page, entry.expand)
      }
      await expect(valueSheets(page)).toHaveCount(10)
    })

    await test.step('at the tenth level the List and Map expand are off with the tooltip', async () => {
      const text = mapEntry(level, 0)
      const list = mapEntry(level, 1)
      const map = mapEntry(level, 2)
      await expect(text.keyInput).toHaveValue('leaf_text')
      await expect(list.typeCell).toHaveText('array')
      await expect(map.typeCell).toHaveText('map')
      await expectVisuallyDisabled(list.expand, 'the List expand at the tenth level')
      await expectVisuallyDisabled(map.expand, 'the Map expand at the tenth level')

      // A disabled button takes no hover, so its tooltip sits on the wrapper around it.
      await map.expand.locator('xpath=..').hover()
      await waitForTooltipText(page, NESTED_LIMIT_NOTE, 'the nested level limit tooltip', 5_000)
      await expect(page.getByRole('tooltip')).toHaveText(NESTED_LIMIT_NOTE)
      await parkPointer(page)

      await expect(text.expand, 'the text expand stays on').toBeEnabled()
      const textSheet = await openNestedEditor(page, text.expand)
      await expect(textSheet.locator('[data-testid="value-editor-type-badge"]')).toHaveText('string')
      await closeValueEditor(page, textSheet)
      await expect(valueSheets(page)).toHaveCount(10)
    })
  })

  test('a read-only sheet opens its nested level read-only', async ({ page, request }) => {
    const base = localFunctionNode(MAP_FN, 'Map_Fn', {
      inputs: [{ name: 'cfg', type: 'map', required: false }],
      nodes: [logNode(MAP_FN_BODY, 'Log', "'map body'")],
      edges: [startEdge(MAP_FN_BODY)],
    })
    const node = {
      ...base,
      data: {
        ...(base.data as Record<string, unknown>),
        elementTypes: { cfg: { outer: 'map' } },
        config: { values: { cfg: { outer: { k: 'v' } } }, outputBindings: {}, profileBindings: [] },
      },
    }
    const fn = await publishLibraryFunction(request, {
      name: `zz-11541-s6b-readonly-${randomUUID().slice(0, 8)}`,
      workflow: { nodes: [node], edges: [startEdge(MAP_FN)] },
    })
    try {
      await openFunctionView(page, fn.functionId, fn.version)
      const win = await openBlockSheet(page, MAP_FN)
      await expect(win.getByRole('button', { name: 'Save', exact: true }), 'the View opens the window read-only').toHaveCount(0)
      const first = await openBlockEditor(page, win, 'cfg')
      await expect(sheetSave(first)).toBeDisabled()
      await expect(mapEntry(first, 0).keyInput).toBeDisabled()

      const second = await openNestedEditor(page, mapEntry(first, 0).expand)
      const entry = mapEntry(second, 0)
      await expect(entry.keyInput).toHaveValue('k')
      await expect(entry.valueInput).toHaveValue('v')
      await expect(entry.keyInput, 'the nested level takes no change').toBeDisabled()
      await expect(entry.valueInput).toBeDisabled()
      await expect(entry.typeCell).toBeDisabled()
      await expect(second.locator('[data-testid="map-add-entry"]')).toBeDisabled()
      await expect(sheetSave(second)).toBeDisabled()
    } finally {
      await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
      await deleteLibraryFunction(request, fn.functionId)
    }
  })

  test('New variable > Map: nested levels offer every type, and a whole Float keeps its type', async ({ page }) => {
    const win = await openCreateModal(page)
    await setCreateName(page, NEW_MAP, win)
    await setCreateType(page, 'map', win)

    await test.step('Add entry > Map > expand opens a second level offering all six types', async () => {
      const first = await openValueEditor(page, win)
      await setValueEditorView(page, first, 'Visual')
      const outer = await addEntry(page, first, 0, 'outer', 'map')
      await expect(outer.valueInput, 'the Map default').toHaveValue('{}')
      const second = await openNestedEditor(page, outer.expand)
      await expectStepped(first, second)
      await second.locator('[data-testid="map-add-entry"]').click()
      expect(await typeOptions(page, mapEntry(second, 0).typeCell), 'the nested entry offers all six types').toEqual([
        ...SIX_TYPES,
      ])
    })

    await test.step('Map again opens an editable third level; its numbers are written as typed', async () => {
      const second = valueSheets(page).nth(1)
      const inner = mapEntry(second, 0)
      await inner.keyInput.fill('inner')
      await pickEntryTypeAtOnce(page, inner.typeCell, 'map')
      const third = await openNestedEditor(page, inner.expand)
      const n = await addEntry(page, third, 0, 'n', 'integer')
      await n.valueInput.fill('3')
      const f = await addEntry(page, third, 1, 'f', 'float')
      await f.valueInput.fill('3.0')
      await saveValueEditor(third)
      await closeValueEditor(page, third)
      await expect(inner.valueInput).toHaveValue(THIRD_LEVEL_TEXT)
      await saveValueEditor(second)
      await closeValueEditor(page, second)
      const first = valueSheets(page).first()
      await expect(mapEntry(first, 0).valueInput).toHaveValue(SECOND_LEVEL_TEXT)
      await saveValueEditor(first)
      await closeValueEditor(page, first)
      await submitCreate(page, win)
      await expect(win).toBeHidden()
    })

    await test.step('the saved Test keeps the nested numbers as written', async () => {
      await saveTest(page)
      const stored = (await getTest(page.request, testId)).variables[NEW_MAP]
      expect(stored.type).toBe('map')
      expect(stored.elementTypes).toEqual({ outer: 'map' })
      expect(stored.value.outer, 'the nested value is kept as its written JSON text').toBe(SECOND_LEVEL_TEXT)
    })

    await test.step('reopened, 3.0 reads back as a Float and 3 as an Integer', async () => {
      await openTest(page, testId)
      const first = await openVariableEditor(page, NEW_MAP)
      const second = await openNestedEditor(page, mapEntry(first, 0).expand)
      await expect(mapEntry(second, 0).typeCell).toHaveText('map')
      await expect(mapEntry(second, 0).valueInput, 'a deeper Map reads in the same spaced form').toHaveValue(
        THIRD_LEVEL_TEXT,
      )
      const third = await openNestedEditor(page, mapEntry(second, 0).expand)
      await expect(mapEntry(third, 0).keyInput).toHaveValue('n')
      await expect(mapEntry(third, 0).valueInput).toHaveValue('3')
      await expect(mapEntry(third, 0).typeCell).toHaveText('integer')
      await expect(mapEntry(third, 1).keyInput).toHaveValue('f')
      await expect(mapEntry(third, 1).valueInput).toHaveValue('3.0')
      await expect(mapEntry(third, 1).typeCell).toHaveText('float')
    })
  })
})
