/**
 * V-ENTRY-BEHAVIOR-SWITCH-FUNCTIONAL: an entry's {x} switch and type change ask before they clear a value.
 * Design Decisions: FIELD-6, FIELD-7, FIELD-13, VMGR-110
 * REQ: REQ-3.1.1.5, REQ-3.1.3.19
 *
 * Pass Criteria:
 * 1. {x} on a map entry or list item holding text, a List or a Map asks `Switch the field to an expression?` /
 *    `The current value is cleared.` with Cancel, Clear and Clear & Empty; a number entry offers Cancel and Clear.
 * 2. Cancel keeps the entry plain with its value; Clear leaves an empty {x}; Clear & Empty puts `''`, `[]` or `{}`
 *    in as the expression; an entry holding nothing switches at once, both ways.
 * 3. {x} back to a plain value asks `Switch the field to a plain value?` with Cancel and Clear; Clear leaves the
 *    type default, Cancel keeps the expression.
 * 4. An {x} map entry and an {x} list item have the expand (two diagonal arrows); it opens that entry's
 *    expression editor, whose Apply writes the entry.
 * 5. The saved Test holds each {x} entry as its dotted expression flag with its source, the plain ones as values;
 *    a run evaluates every entry as the switch left it.
 * 6. A type change on an entry holding nothing, or its type default, sets the new type's default at once
 *    (`''`, `0`, the Float zero, `false`, `[]`, `{}`), and a List / Map default opens at once from its expand.
 * 7. A type change that would clear a value asks `Change entry type?` (list items: `Change item type?`) with
 *    `Changing type to <next> will clear 1 existing <prev> value. This cannot be undone.`; Cancel keeps the
 *    type and the value, Change type leaves the default; the saved Test holds the new types and defaults.
 * 8. The variable window asks `Change variable type?` with the same sentence, and Cancel keeps the variable.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, readFixture } from '../../helpers/element-types'
import { openBlockSheet } from '../../helpers/workbench'
import { formatEntries } from '../../helpers/log-reader'
import { cancelWindow, closeValueEditor, expectWindowValue, openEditWindow, saveValueEditor, setCreateType } from '../../helpers/variable-create'
import { listItem, mapEntry, openBlockEditor, openNestedEditor } from '../../helpers/entry-editors'
import {
  answerSwitch,
  answerTypeChange,
  applyInExpressionEditor,
  expectCodeText,
  expectSwitchQuestion,
  expectTypeChangeQuestion,
  expressionEditorModal,
  pickEntryType,
  pickEntryTypeAtOnce,
  runTest,
  saveBlockAndTest,
  storedNode,
  structureOf,
  switchAtOnce,
  typeChangeSentence,
  writeCode,
} from '../../helpers/entry-behavior'
import { BACKEND_URL } from '../../helpers/config'

const FN = '01a305eb-b4dc-42bd-a57a-5d61b99ac02d'
const FIXTURE = 'fixture-behavior-switch.json'
const IN_ALL = ['Cancel', 'Clear', 'Clear & Empty'] as const
const IN_NUMBER = ['Cancel', 'Clear'] as const
const OUT = ['Cancel', 'Clear'] as const

// The map input's entries and the list input's items, by position.
const TXT = 0
const NUM = 1
const SUB = 2
const ARR = 3
const EMPTY = 4

/** Open an {x} entry's expression editor from its expand, check its title and Apply `text`. */
async function editThroughExpand(page: Page, expand: Locator, title: string, text: string): Promise<void> {
  await expect(expand, 'the {x} entry has the expand').toBeEnabled()
  await expect(expand.locator('svg.lucide-maximize-2'), 'drawn as two diagonal arrows').toHaveCount(1)
  await expand.click()
  const modal = expressionEditorModal(page)
  await expect(modal).toBeVisible()
  await expect(modal.getByRole('heading', { level: 2 })).toHaveText(title)
  await applyInExpressionEditor(page, modal, text)
}

test.describe('V-ENTRY-BEHAVIOR-SWITCH-FUNCTIONAL: entry {x} switch and type change', () => {
  let testId = ''

  test.beforeEach(async ({ page }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('{x} on an entry asks first, Clear & Empty fills the empty value, and the run reads each entry', async ({
    page,
  }) => {
    const win = await openBlockSheet(page, FN)

    await test.step('map entries: the switch asks with the FIELD-7 dialog', async () => {
      const map = await openBlockEditor(page, win, 'cfg')
      const txt = mapEntry(map, TXT)
      await txt.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Cancel')
      await expect(txt.exprToggle, 'Cancel keeps the entry plain').toHaveAttribute('aria-pressed', 'false')
      await expect(txt.valueInput, 'Cancel keeps the value').toHaveValue('hello')

      await txt.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Clear & Empty')
      await expect(txt.exprToggle).toHaveAttribute('aria-pressed', 'true')
      await expectCodeText(txt.exprBox, "''", 'Clear & Empty puts the empty text in as the expression')

      const num = mapEntry(map, NUM)
      await num.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_NUMBER), 'Clear')
      await expectCodeText(num.exprBox, '', 'Clear leaves an empty expression')
      await editThroughExpand(page, num.expand, 'Edit Entry 1 value', '2 + 4')
      await expectCodeText(num.exprBox, '2 + 4', 'the expression editor writes the entry')

      const sub = mapEntry(map, SUB)
      await sub.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Clear & Empty')
      await expectCodeText(sub.exprBox, '{}', 'a Map entry takes {} as the expression')

      const arr = mapEntry(map, ARR)
      await arr.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Clear & Empty')
      await expectCodeText(arr.exprBox, '[]', 'a List entry takes [] as the expression')

      const empty = mapEntry(map, EMPTY)
      await switchAtOnce(page, empty.exprToggle, true)
      await writeCode(page, empty.exprBox, "'e'")
    })

    await test.step('map entries: switching back asks, Clear leaves the type default, Cancel keeps {x}', async () => {
      const map = page.locator('[data-testid="value-editor-sheet"]')
      const sub = mapEntry(map, SUB)
      await sub.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'out', OUT), 'Clear')
      await expect(sub.exprToggle).toHaveAttribute('aria-pressed', 'false')
      await expect(sub.valueInput, 'back to plain, the Map default').toHaveValue('{}')
      await expect(sub.typeCell, 'the entry keeps its type').toHaveText('map')

      const txt = mapEntry(map, TXT)
      await txt.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'out', OUT), 'Cancel')
      await expect(txt.exprToggle).toHaveAttribute('aria-pressed', 'true')
      await expectCodeText(txt.exprBox, "''", 'Cancel keeps the expression')

      await saveValueEditor(map)
      await closeValueEditor(page, map)
    })

    await test.step('list items: the same questions, and an {x} item opens its expression editor', async () => {
      const list = await openBlockEditor(page, win, 'lst')
      const first = listItem(list, 0)
      await first.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Clear & Empty')
      await expectCodeText(first.exprBox, "''", 'a text item takes the empty text')

      const second = listItem(list, 1)
      await second.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Clear & Empty')
      await expectCodeText(second.exprBox, '[]', 'a List item takes []')
      await editThroughExpand(page, second.expand, 'Edit Item 1 value', '[7]')
      await expectCodeText(second.exprBox, '[7]', 'the expression editor writes the item')

      const third = listItem(list, 2)
      await third.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', IN_ALL), 'Clear & Empty')
      await expectCodeText(third.exprBox, '{}', 'a Map item takes {}')

      const fourth = listItem(list, 3)
      await switchAtOnce(page, fourth.exprToggle, true)
      await switchAtOnce(page, fourth.exprToggle, false)
      await expect(fourth.valueInput, 'an empty expression goes back at once to the text default').toHaveValue('')
      await fourth.valueInput.fill('z')

      await saveValueEditor(list)
      await closeValueEditor(page, list)
    })

    await test.step('the saved Test holds each {x} entry as its dotted flag', async () => {
      await saveBlockAndTest(page, win)
      const node = await storedNode(page.request, testId, FN)
      const flags = node.data.expressionFields as string[]
      expect([...flags].sort()).toEqual(['cfg.arr', 'cfg.empty', 'cfg.num', 'cfg.txt', 'lst.0', 'lst.1', 'lst.2'])
      const { cfg, lst } = node.data.config.values
      expect({ ...cfg, sub: structureOf(cfg.sub) }).toEqual({
        txt: "''",
        num: '2 + 4',
        sub: {},
        arr: '[]',
        empty: "'e'",
      })
      expect(node.data.elementTypes.cfg.sub, 'the entry back from {x} keeps its Map type').toBe('map')
      expect(lst).toEqual(["''", '[7]', '{}', 'z'])
      expect(node.data.elementTypes.lst[3]).toBe('string')
    })

    await test.step('the run evaluates every entry as the switch left it', async () => {
      const run = await runTest(page)
      expect(run.verdict, formatEntries(run.entries)).toBe('passed')
      const line = 'SW txt=[] num=6 sub=0 arr=0 empty=e l0=[] l1=7 l2=0 l3=z'
      expect(run.entries.map((entry) => entry.message), formatEntries(run.entries)).toContain(line)
    })
  })

  test('a type change sets the type default and asks before it clears a value', async ({ page }) => {
    const win = await openBlockSheet(page, FN)

    await test.step('an entry holding its default changes type at once and takes the new default', async () => {
      const map = await openBlockEditor(page, win, 'cfg')
      const empty = mapEntry(map, EMPTY)
      await pickEntryTypeAtOnce(page, empty.typeCell, 'integer')
      await expect(empty.valueInput).toHaveValue('0')
      await pickEntryTypeAtOnce(page, empty.typeCell, 'float')
      await expect(empty.valueInput, 'the Float default, a Float zero').toHaveValue('0')
      await pickEntryTypeAtOnce(page, empty.typeCell, 'boolean')
      await expect(empty.valueInput).toHaveValue('false')
      await pickEntryTypeAtOnce(page, empty.typeCell, 'array')
      await expect(empty.valueInput).toHaveValue('[]')

      // A List default is valid at once, so its expand opens the next level.
      const listLevel = await openNestedEditor(page, empty.expand)
      await expect(listLevel.locator('[data-testid="array-edit-body"]')).toBeVisible()
      await expect(listLevel.locator('[data-testid^="array-edit-input-"]')).toHaveCount(0)
      await closeValueEditor(page, listLevel)

      await pickEntryTypeAtOnce(page, empty.typeCell, 'map')
      await expect(empty.valueInput).toHaveValue('{}')
      const mapLevel = await openNestedEditor(page, empty.expand)
      await expect(mapLevel.locator('[data-testid^="map-edit-key-"]')).toHaveCount(0)
      await mapLevel.locator('[data-testid="map-add-entry"]').click()
      const nested = mapEntry(mapLevel, 0)
      await nested.keyInput.fill('f')
      await pickEntryTypeAtOnce(page, nested.typeCell, 'float')
      await saveValueEditor(mapLevel)
      await closeValueEditor(page, mapLevel)
      await expect(empty.valueInput, 'a nested Float default is written 0.0').toHaveValue('{"f": 0.0}')

      await pickEntryType(page, empty.typeCell, 'string')
      const ask = await expectTypeChangeQuestion(page, 'entry', typeChangeSentence('string', '1 existing map entry'))
      await answerTypeChange(ask, 'Change type')
      await expect(empty.typeCell).toHaveText('string')
      await expect(empty.valueInput).toHaveValue('')
    })

    await test.step('an entry holding a value asks Change entry type?; Cancel keeps it, Change type clears it', async () => {
      const map = page.locator('[data-testid="value-editor-sheet"]')
      const txt = mapEntry(map, TXT)
      const sentence = typeChangeSentence('integer', '1 existing string value')
      await pickEntryType(page, txt.typeCell, 'integer')
      await answerTypeChange(await expectTypeChangeQuestion(page, 'entry', sentence), 'Cancel')
      await expect(txt.typeCell, 'Cancel keeps the type').toHaveText('string')
      await expect(txt.valueInput, 'Cancel keeps the value').toHaveValue('hello')

      await pickEntryType(page, txt.typeCell, 'integer')
      await answerTypeChange(await expectTypeChangeQuestion(page, 'entry', sentence), 'Change type')
      await expect(txt.typeCell).toHaveText('integer')
      await expect(txt.valueInput, 'the Integer default').toHaveValue('0')

      await saveValueEditor(map)
      await closeValueEditor(page, map)
    })

    await test.step('a list item asks Change item type?', async () => {
      const list = await openBlockEditor(page, win, 'lst')
      const first = listItem(list, 0)
      await pickEntryType(page, first.typeCell, 'boolean')
      const ask = await expectTypeChangeQuestion(page, 'item', typeChangeSentence('boolean', '1 existing string value'))
      await answerTypeChange(ask, 'Change type')
      await expect(first.typeCell).toHaveText('boolean')
      await expect(first.valueInput).toHaveValue('false')

      const second = listItem(list, 1)
      await pickEntryType(page, second.typeCell, 'map')
      const keep = await expectTypeChangeQuestion(page, 'item', typeChangeSentence('map', '2 existing array entries'))
      await answerTypeChange(keep, 'Cancel')
      await expect(second.typeCell).toHaveText('array')
      await expect(second.valueInput).toHaveValue(/^\["1", ?"2"\]$/)

      await saveValueEditor(list)
      await closeValueEditor(page, list)
    })

    await test.step('the saved Test holds the new types and their defaults', async () => {
      await saveBlockAndTest(page, win)
      const node = await storedNode(page.request, testId, FN)
      expect(node.data.elementTypes.cfg).toEqual({
        txt: 'integer',
        num: 'integer',
        sub: 'map',
        arr: 'array',
        empty: 'string',
      })
      const { cfg, lst } = node.data.config.values
      expect(String(cfg.txt), 'the Integer default is stored').toBe('0')
      expect(cfg.empty).toBe('')
      expect(node.data.elementTypes.lst).toEqual(['boolean', 'array', 'map', 'string'])
      expect(lst[0]).toBe(false)
      expect(structureOf(lst[1]), 'Cancel kept the List item').toEqual(['1', '2'])
    })

    await test.step('the variable window asks Change variable type? with the same sentence', async () => {
      const note = await openEditWindow(page, 'note')
      await setCreateType(page, 'integer', note)
      const ask = await expectTypeChangeQuestion(
        page,
        'variable',
        typeChangeSentence('integer', '1 existing string value'),
      )
      await answerTypeChange(ask, 'Cancel')
      await expect(note.locator('[data-testid="create-type-select"]'), 'Cancel keeps the type').toContainText('String')
      await expectWindowValue(note, 'hello')
      await cancelWindow(page, note)
    })
  })
})
