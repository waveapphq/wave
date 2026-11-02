/**
 * V-PYEDIT-04: Python script editor, inline rename
 * Design Decisions: PYRUN-19
 * REQ: REQ-3.4.1.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Applying a rename is the functional suite's contract; this spec is the
 * visual one: what the box looks like and what it leaves behind on Esc.
 *
 * Pass Criteria:
 * 1. F2 on the selected symbol "values" opens the inline rename box anchored
 *    under it.
 * 2. The current name is pre-filled and selected.
 * 3. Every occurrence of "values" in the script is highlighted.
 * 4. The hint reads "Rename symbol - Enter to apply - Esc to cancel", with the
 *    separator the source uses.
 * 5. Esc closes the box and leaves the script unchanged.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { deletePythonTest, openPythonScriptSheet, seedAndOpenPythonTest } from './python-seed'

/** The renamed symbol of the approved render and where it sits. */
const SYMBOL = 'values'
const SYMBOL_LINE = 5
const SYMBOL_LINE_TEXT = 'values = [row["temp_c"] for row in readings]'
const OCCURRENCES = 2

/** Verbatim from `lib/codemirror/python-rename.ts`; the separator is a middle dot. */
const HINT = 'Rename symbol · Enter to apply · Esc to cancel'

/** How far the box may sit from the symbol's left edge and still read as anchored to it. */
const ANCHOR_TOLERANCE_PX = 40

const created: string[] = []

const renameBox = (page: Page) => page.locator('[data-testid="python-rename-box"]')
const renameInput = (page: Page) => page.locator('[data-testid="python-rename-input"]')
const renameHint = (page: Page) => page.locator('[data-testid="python-rename-hint"]')
const occurrences = (sheet: Locator) => sheet.locator('.cm-python-rename-occurrence')
const saveButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-save-button"]')
const scriptLine = (sheet: Locator, line: number) => sheet.locator('.cm-line').nth(line - 1)

/** Put the caret on the first character of a script line. */
async function caretAtLineStart(page: Page, sheet: Locator, line: number): Promise<void> {
  await sheet.locator('.cm-content').click()
  await page.keyboard.press('ControlOrMeta+Home')
  for (let step = 1; step < line; step += 1) await page.keyboard.press('ArrowDown')
}

test.describe('V-PYEDIT-04: renaming a symbol in the Python script editor', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PYEDIT-04 box: F2 opens the box under the symbol, pre-filled and hinted', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-04 box'))
    const sheet = await openPythonScriptSheet(page)

    await caretAtLineStart(page, sheet, SYMBOL_LINE)
    await page.keyboard.press('F2')
    await expect(renameBox(page)).toBeVisible()

    // PYRUN-19: every occurrence of the symbol is painted while the box is open.
    await expect(occurrences(sheet)).toHaveCount(OCCURRENCES)
    for (let index = 0; index < OCCURRENCES; index += 1) {
      await expect(occurrences(sheet).nth(index)).toHaveText(SYMBOL)
    }

    // The box is placed after CodeMirror's next measure pass, so both reads retry.
    type Rect = { x: number; y: number; width: number; height: number }
    let boxRect: Rect | null = null
    let symbolRect: Rect | null = null
    await expect(async () => {
      ;[boxRect, symbolRect] = await Promise.all([
        renameBox(page).boundingBox(),
        occurrences(sheet).first().boundingBox(),
      ])
      expect(boxRect, 'the rename box has a box').not.toBeNull()
      expect(symbolRect, 'the marked symbol has a box').not.toBeNull()
    }).toPass({ timeout: 10_000 })
    expect(boxRect!.y, 'the box sits under the symbol').toBeGreaterThanOrEqual(
      symbolRect!.y + symbolRect!.height - 2,
    )
    expect(
      Math.abs(boxRect!.x - symbolRect!.x),
      'the box is anchored to the symbol, not to the sheet',
    ).toBeLessThanOrEqual(ANCHOR_TOLERANCE_PX)

    // The name is there and the box has the keyboard.
    await expect(renameInput(page)).toHaveValue(SYMBOL)
    await expect(renameInput(page)).toBeFocused()

    await expect(renameHint(page)).toHaveText(HINT)
  })

  test('V-PYEDIT-04 selection: the pre-filled name is selected, so typing replaces it', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-04 selection'))
    const sheet = await openPythonScriptSheet(page)

    await caretAtLineStart(page, sheet, SYMBOL_LINE)
    await page.keyboard.press('F2')
    await expect(renameInput(page)).toHaveValue(SYMBOL)

    const selected = await renameInput(page).evaluate((input) => {
      const field = input as HTMLInputElement
      return field.value.slice(field.selectionStart ?? 0, field.selectionEnd ?? 0)
    })
    expect(selected, 'the pre-filled name is selected').toBe(SYMBOL)
  })

  test('V-PYEDIT-04 cancel: Esc closes the box and leaves the script alone', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-04 cancel'))
    const sheet = await openPythonScriptSheet(page)

    await caretAtLineStart(page, sheet, SYMBOL_LINE)
    await page.keyboard.press('F2')
    await expect(renameBox(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(renameBox(page)).toBeHidden()
    await expect(occurrences(sheet)).toHaveCount(0)

    // The sheet stays open and the draft never changed, so Save is still dead.
    await expect(sheet).toBeVisible()
    await expect(saveButton(sheet)).toBeDisabled()
    await expect(scriptLine(sheet, SYMBOL_LINE)).toHaveText(SYMBOL_LINE_TEXT)
  })
})
