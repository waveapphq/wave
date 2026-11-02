/**
 * V-FIELD-EXPRESSION-TEXT-FUNCTIONAL: a stored multi-line expression and a whole-number float survive their edits
 * Wireframe: none (functional)
 * Design Decisions: FIELD-1, VMGR-110
 * REQ: REQ-3.1.3.14, REQ-3.1.1.5
 *
 * Fixture `fixture-expression-text.json` (POST /tests, zero validation errors): two Log Blocks whose message is a
 * stored four-line expression, and two Local Function Blocks with a Required float input `ratio` and an optional
 * text input `note` (default `base`); `ratio_kept` holds `2.0` and `first`, `ratio_typed` holds `1.5`. The Test is
 * deleted afterwards.
 *
 * Pass Criteria:
 * 1. The imported Test validates with zero errors and stores both messages with their line breaks and `ratio`
 *    as `2.0`.
 * 2. Inline field: appending ` + "-gamma"` to the stored expression keeps its four lines in the field, and the
 *    stored Test holds `(\n    "alpha"\n    + "-beta"\n) + "-gamma"` after the Test Save.
 * 3. Larger editor (expand in {x} mode): appending ` + "-blue"` there and Apply keeps the four lines in the
 *    editor and in the field, and the stored Test holds `(\n    "red"\n    + "-green"\n) + "-blue"`.
 * 4. `ratio_kept`: the window shows `ratio` as `2.0`; after `note` is edited to `second` and saved, `ratio` still
 *    reads `2.0` on reopen and is stored as `2.0`, never `2`.
 * 5. `ratio_typed`: `ratio` typed as `4.0` is stored as `4.0` and `note` stays not set.
 * 6. The run passes: the Logs print `alpha-beta-gamma` and `red-green-blue`, the Function bodies print
 *    `ratio=2.0 note=second` and `ratio=4.0 note=base`, and every root Block succeeds.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { readFixture } from '../../helpers/element-types'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { expectNodesSuccess, finishRun, startRun } from '../../helpers/k8s-run'
import { closeUnchangedSheet, deleteSeededTest, fieldBox, storedBlock } from '../../helpers/list-fields'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'

const IDS = {
  inline: '85beae10-d3d9-49cb-a0ee-5855816022d9',
  editor: '07a07c15-ac3d-4a26-8236-011a29f38e48',
  fnKept: 'c66b695a-ba71-4930-98c5-7661cadd5a83',
  fnTyped: 'c3c285f7-32d4-4c35-a4e3-7da561fdebd8',
  done: 'ffbd03d5-7e4e-43ca-acb1-e4c47dda2a80',
} as const

const DONE_MARKER = 'expression-text-done'

const INLINE_STORED = '(\n    "alpha"\n    + "-beta"\n)'
const INLINE_EDITED = '(\n    "alpha"\n    + "-beta"\n) + "-gamma"'
const EDITOR_STORED = '(\n    "red"\n    + "-green"\n)'
const EDITOR_EDITED = '(\n    "red"\n    + "-green"\n) + "-blue"'

const lines = (text: string): string[] => text.split('\n')

/** The expression's lines as the editor draws them, spaces kept. */
async function expectLines(content: Locator, text: string, what: string): Promise<void> {
  await expect.poll(() => content.locator('.cm-line').allTextContents(), { message: what }).toEqual(lines(text))
}

/** Put the cursor at the end of the last line and add `text` there in one input. */
async function appendToLastLine(page: Page, content: Locator, text: string): Promise<void> {
  await content.locator('.cm-line').last().click()
  await page.keyboard.press('End')
  await page.keyboard.insertText(text)
}

async function editInline(page: Page): Promise<void> {
  const sheet = await openBlockSheet(page, IDS.inline)
  const content = sheet.locator('[data-testid="param-input-message"] .cm-content')
  await expectLines(content, INLINE_STORED, 'the inline field shows the stored lines')
  await appendToLastLine(page, content, ' + "-gamma"')
  await expectLines(content, INLINE_EDITED, 'the first inline edit keeps the line breaks')
  await leaveExpressionEditor(content)
  await saveBlockSheet(sheet)
}

async function editInLargerEditor(page: Page): Promise<void> {
  const sheet = await openBlockSheet(page, IDS.editor)
  const field = sheet.locator('[data-testid="param-input-message"] .cm-content')
  await expectLines(field, EDITOR_STORED, 'the inline field shows the stored lines')
  await sheet.getByTestId('param-expand-message').click()
  const modal = page.getByTestId('expression-editor-modal')
  await expect(modal).toBeVisible()
  const content = modal.locator('.cm-content')
  await expectLines(content, EDITOR_STORED, 'the larger editor opens on the stored lines')
  await appendToLastLine(page, content, ' + "-blue"')
  await expectLines(content, EDITOR_EDITED, 'the first edit in the larger editor keeps the line breaks')
  await leaveExpressionEditor(content)
  await modal.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(modal).toBeHidden()
  await expectLines(field, EDITOR_EDITED, 'the field takes the edited lines')
  await leaveExpressionEditor(field)
  await saveBlockSheet(sheet)
}

/** Another input is edited; the float keeps its `.0` (REQ-3.1.3.14). */
async function editBesideFloat(page: Page): Promise<void> {
  const sheet = await openBlockSheet(page, IDS.fnKept)
  const ratio = sheet.getByTestId('param-input-ratio')
  await expect(ratio, 'the window shows the stored whole-number float').toHaveValue('2.0')
  const note = fieldBox(sheet, 'note')
  await expect(note).toHaveValue('first')
  await note.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('second')
  await expect(note).toHaveValue('second')
  await expect(ratio).toHaveValue('2.0')
  await saveBlockSheet(sheet)

  const again = await openBlockSheet(page, IDS.fnKept)
  await expect(again.getByTestId('param-input-ratio'), 'the float reopens as 2.0').toHaveValue('2.0')
  await expect(fieldBox(again, 'note')).toHaveValue('second')
  await closeUnchangedSheet(again)
}

async function typeWholeFloat(page: Page): Promise<void> {
  const sheet = await openBlockSheet(page, IDS.fnTyped)
  const ratio = sheet.getByTestId('param-input-ratio')
  await expect(ratio).toHaveValue('1.5')
  await ratio.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('4.0')
  await expect(ratio).toHaveValue('4.0')
  await saveBlockSheet(sheet)
}

test.describe('V-FIELD-EXPRESSION-TEXT-FUNCTIONAL: expression text and whole-number floats after an edit', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  test('a stored multi-line expression keeps its line breaks and a float input keeps 2.0 after an edit', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    testId = await importValidateAndNavigate(page, readFixture(__dirname, 'fixture-expression-text.json'))

    await test.step('the imported Test', async () => {
      expect((await storedBlock(page.request, testId, IDS.inline)).config.values.message).toBe(INLINE_STORED)
      expect((await storedBlock(page.request, testId, IDS.editor)).config.values.message).toBe(EDITOR_STORED)
      expect((await storedBlock(page.request, testId, IDS.fnKept)).config.values.ratio).toBe('2.0')
    })

    await test.step('the first edit in the inline field', () => editInline(page))
    await test.step('the first edit in the larger editor', () => editInLargerEditor(page))
    await test.step('another input edited beside 2.0', () => editBesideFloat(page))
    await test.step('a whole-number float typed', () => typeWholeFloat(page))
    await saveTest(page)

    await test.step('the stored Test', async () => {
      const inline = await storedBlock(page.request, testId, IDS.inline)
      expect(inline.config.values.message, 'the inline edit is stored with its line breaks').toBe(INLINE_EDITED)
      expect(inline.expressionFields).toContain('message')
      const editor = await storedBlock(page.request, testId, IDS.editor)
      expect(editor.config.values.message, 'the editor edit is stored with its line breaks').toBe(EDITOR_EDITED)
      const kept = (await storedBlock(page.request, testId, IDS.fnKept)).config.values
      expect(kept.ratio, 'the float stays 2.0').toBe('2.0')
      expect(kept.note).toBe('second')
      const typed = (await storedBlock(page.request, testId, IDS.fnTyped)).config.values
      expect(typed.ratio, 'the typed float keeps its .0').toBe('4.0')
      expect('note' in typed, 'note stays not set').toBe(false)
    })

    await test.step('the run', async () => {
      const status = await startRun(page)
      const logs = await finishRun(page, status, DONE_MARKER)
      for (const line of ['alpha-beta-gamma', 'red-green-blue', 'ratio=2.0 note=second', 'ratio=4.0 note=base']) {
        expect(logs, `the run prints ${line}`).toContain(line)
      }
      await expectNodesSuccess(page, Object.values(IDS))
    })
  })
})
