/**
 * V-ENTRY-BEHAVIOR-LISTS-FUNCTIONAL: per-item {x} on Block list fields, kept on its item and run as written.
 * Design Decisions: FIELD-6, FIELD-10, FIELD-13
 * REQ: REQ-3.1.1.5, REQ-3.1.3.19
 *
 * Pass Criteria:
 * 1. HTTP Retryable Codes (a plain list field) and a Function Block list input offer {x} on every item.
 * 2. Save writes an {x} item as the dotted flag of its index with its source; the item opens as {x} again.
 * 3. The sheet keeps its Visual / Code switch: Code shows an {x} item as `{{ expr }}` in its place, and an
 *    item written that way in Code reads back as {x} at the same index.
 * 4. Deleting an item above an {x} item keeps the flag on that same item in the saved Test.
 * 5. A typed list item switched to {x} stores no stale List type, and its expression `"abc"` runs as the
 *    text `abc` (never JSON-parsed by its old type), beside an Integer item that runs as a number.
 *
 * Phase: functional-workflow (imports its own fixture, deletes it after).
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, readFixture } from '../../helpers/element-types'
import { openBlockSheet } from '../../helpers/workbench'
import { formatEntries } from '../../helpers/log-reader'
import {
  closeValueEditor,
  replaceValueEditorCode,
  saveValueEditor,
  setValueEditorView,
} from '../../helpers/variable-create'
import { expandGroup, expressionToggles, listItem, openBlockEditor } from '../../helpers/entry-editors'
import {
  answerSwitch,
  codeText,
  expectCodeText,
  expectSwitchQuestion,
  runTest,
  saveBlockAndTest,
  storedNode,
  writeCode,
} from '../../helpers/entry-behavior'
import { BACKEND_URL } from '../../helpers/config'

const HTTP = '9a07501b-2e65-4f23-9eb8-352081afc175'
const LIST_FN = '2a847914-8b14-40da-bc74-eed54a034db6'
const CODES = 'retryable_status_codes'
const RETRIES = 'Timeouts & Retries'
const EXPR = "'5' + '04'"

/** Open the HTTP Block's Retryable Codes list editor. */
async function openRetryCodes(page: Page): Promise<{ win: Locator; list: Locator }> {
  const win = await openBlockSheet(page, HTTP)
  await expandGroup(win, RETRIES)
  return { win, list: await openBlockEditor(page, win, CODES) }
}

/** The stored Retryable Codes and the {x} flags of the HTTP Block. */
async function storedCodes(page: Page, testId: string): Promise<{ values: unknown[]; flags: string[] }> {
  const node = await storedNode(page.request, testId, HTTP)
  return {
    values: node.data.config.values[CODES] as unknown[],
    flags: (node.data.expressionFields as string[]).filter((flag) => flag.startsWith(`${CODES}.`)),
  }
}

test.describe('V-ENTRY-BEHAVIOR-LISTS-FUNCTIONAL: per-item {x} on Block list fields', () => {
  let testId = ''

  test.beforeEach(async ({ page }) => {
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-behavior-lists.json'), {
      injectHttp: true,
    })
  })

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await deleteTest(request, testId)
    testId = ''
  })

  test('Retryable Codes keeps an {x} item on its index through Save, a delete above it and the Code view', async ({
    page,
  }) => {
    await test.step('every item has {x}; Save writes the {x} item as its index', async () => {
      const { win, list } = await openRetryCodes(page)
      await expect(expressionToggles(list), 'every item offers {x}').toHaveCount(3)
      const third = listItem(list, 2)
      await third.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', ['Cancel', 'Clear', 'Clear & Empty']), 'Clear')
      await writeCode(page, third.exprBox, EXPR)
      await saveValueEditor(list)
      await closeValueEditor(page, list)
      await saveBlockAndTest(page, win)
      expect(await storedCodes(page, testId)).toEqual({ values: ['502', '503', EXPR], flags: [`${CODES}.2`] })
    })

    await test.step('the item opens as {x}; Code shows it as {{ expr }} in its place', async () => {
      const { list } = await openRetryCodes(page)
      await expect(listItem(list, 2).exprToggle).toHaveAttribute('aria-pressed', 'true')
      await expectCodeText(listItem(list, 2).exprBox, EXPR, 'the {x} item keeps its source')
      await expect(listItem(list, 0).valueInput).toHaveValue('502')
      await setValueEditorView(page, list, 'Code')
      await expect
        .poll(() => codeText(list), { message: 'Code shows the {x} item in its place' })
        .toBe(`[\n  "502",\n  "503",\n  {{ ${EXPR} }}\n]`)
      await setValueEditorView(page, list, 'Visual')
    })

    await test.step('deleting the item above keeps the flag on the same item', async () => {
      const list = page.locator('[data-testid="value-editor-sheet"]')
      await listItem(list, 0).remove.click()
      await expect(listItem(list, 0).valueInput).toHaveValue('503')
      await expect(listItem(list, 1).exprToggle, 'the {x} item moved up with its flag').toHaveAttribute(
        'aria-pressed',
        'true',
      )
      await expect(listItem(list, 0).exprToggle).toHaveAttribute('aria-pressed', 'false')
      await saveValueEditor(list)
      await closeValueEditor(page, list)
      await saveBlockAndTest(page, page.locator('[data-testid="element-config-sheet"]'))
      expect(await storedCodes(page, testId)).toEqual({ values: ['503', EXPR], flags: [`${CODES}.1`] })
    })

    await test.step('an item written as {{ expr }} in Code reads back as {x} at the same index', async () => {
      const { win, list } = await openRetryCodes(page)
      await setValueEditorView(page, list, 'Code')
      await replaceValueEditorCode(page, list, `["500", "503", {{ ${EXPR} }}]`)
      await setValueEditorView(page, list, 'Visual')
      await expect(listItem(list, 0).valueInput).toHaveValue('500')
      await expect(listItem(list, 2).exprToggle).toHaveAttribute('aria-pressed', 'true')
      await expectCodeText(listItem(list, 2).exprBox, EXPR, 'Code read the {x} item back')
      await saveValueEditor(list)
      await closeValueEditor(page, list)
      await saveBlockAndTest(page, win)
      expect(await storedCodes(page, testId)).toEqual({ values: ['500', '503', EXPR], flags: [`${CODES}.2`] })
    })

    await test.step('the run evaluates the list', async () => {
      const run = await runTest(page)
      expect(run.verdict, formatEntries(run.entries)).toBe('passed')
    })
  })

  test('a typed list item switched to {x} runs its expression "abc" as the text abc', async ({ page }) => {
    const win = await openBlockSheet(page, LIST_FN)

    await test.step('the Function Block list input offers {x} per item; the List item switches', async () => {
      const list = await openBlockEditor(page, win, 'codes')
      await expect(expressionToggles(list), 'every item offers {x}').toHaveCount(2)
      const second = listItem(list, 1)
      await expect(second.typeCell).toHaveText('array')
      await second.exprToggle.click()
      await answerSwitch(await expectSwitchQuestion(page, 'in', ['Cancel', 'Clear', 'Clear & Empty']), 'Clear')
      await writeCode(page, second.exprBox, '"abc"')
      await saveValueEditor(list)
      await closeValueEditor(page, list)
      await saveBlockAndTest(page, win)
    })

    await test.step('the saved Test flags the item and keeps no stale List type', async () => {
      const node = await storedNode(page.request, testId, LIST_FN)
      expect(node.data.expressionFields).toEqual(['codes.1'])
      const codes = node.data.config.values.codes as unknown[]
      expect(String(codes[0])).toBe('7')
      expect(codes[1]).toBe('"abc"')
      expect(node.data.elementTypes.codes[0]).toBe('integer')
      expect(node.data.elementTypes.codes[1], 'the {x} item holds no List type').toBe('string')
    })

    await test.step('the item opens as {x} again', async () => {
      const again = await openBlockSheet(page, LIST_FN)
      const list = await openBlockEditor(page, again, 'codes')
      await expect(listItem(list, 1).exprToggle).toHaveAttribute('aria-pressed', 'true')
      await expectCodeText(listItem(list, 1).exprBox, '"abc"', 'the {x} item keeps its source')
      await closeValueEditor(page, list)
      await again.locator('button[aria-label="Close"]').first().click()
      await expect(again).toHaveCount(0)
    })

    await test.step('the run reads the item as the text abc and the Integer item as a number', async () => {
      const run = await runTest(page)
      expect(run.verdict, formatEntries(run.entries)).toBe('passed')
      expect(run.entries.map((entry) => entry.message), formatEntries(run.entries)).toContain(
        'F9 item0=8 item1=abc-tail text1=True len1=3',
      )
    })
  })
})
