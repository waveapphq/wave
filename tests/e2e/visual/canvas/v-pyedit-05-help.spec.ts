/**
 * V-PYEDIT-05: Python script editor, help popover
 * Design Decisions: PYRUN-13, PYRUN-18
 * REQ: REQ-3.4.1.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. F1, and clicking the chip, both open the help popover above the chip.
 * 2. The popover's heading is KEYBOARD and it lists every shortcut of PYRUN-13
 *    in order with its action text.
 * 3. An X close control sits at the popover's top-right.
 * 4. The "Show tips" link sits at the bottom, collapsed by default.
 * 5. The editor is still visible around the popover.
 * 6. Esc closes it, a click outside closes it, and focus returns to the editor.
 * 7. The listed keys work: Ctrl+/ turns the line under the cursor into a `# `
 *    comment, which Save keeps in the saved Test; Ctrl+F opens the find panel
 *    and Esc closes it with the editor still open; Ctrl+G opens the Go to line
 *    prompt on the cursor's line.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { saveConfig } from '../../functional/file-picker/picker'
import { getNode } from '../../helpers/element-types'
import { configSheet, saveBtn } from '../../helpers/workbench'
import {
  PYTHON_NODE_ID,
  PYTHON_SCRIPT,
  deletePythonTest,
  openPythonScriptSheet,
  seedAndOpenPythonTest,
} from './python-seed'

/** PYRUN-13, in the order the popover lists them: the chord keys and the action. */
const SHORTCUTS: ReadonlyArray<{ keys: string[]; action: string }> = [
  { keys: ['Ctrl', 'Space'], action: 'Autocomplete' },
  { keys: ['Shift', 'Enter'], action: 'Run' },
  { keys: ['Ctrl', 'Enter'], action: 'Save' },
  { keys: ['Esc'], action: 'Close' },
  { keys: ['F2'], action: 'Rename symbol' },
  { keys: ['Ctrl', '/'], action: 'Toggle comment' },
  { keys: ['Ctrl', 'F'], action: 'Find and replace' },
  { keys: ['Ctrl', 'G'], action: 'Go to line' },
  { keys: ['Tab', 'Shift', 'Tab'], action: 'Indent / outdent' },
  { keys: ['Ctrl', 'Z', 'Ctrl', 'Y'], action: 'Undo / redo' },
]

/** How far a corner control may sit from the popover's own corner. */
const CORNER_TOLERANCE_PX = 24

const created: string[] = []

const popover = (page: Page) => page.locator('[data-testid="python-help-popover"]')
const chip = (sheet: Locator) => sheet.locator('[data-testid="value-editor-help-chip"]')
const keyRows = (page: Page) => popover(page).locator('[data-testid="python-help-key-row"]')

function editorHasFocus(page: Page): Promise<boolean> {
  return page.evaluate(() => document.activeElement?.classList.contains('cm-content') ?? false)
}

test.describe('V-PYEDIT-05: the F1 help of the Python script editor', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PYEDIT-05 open: F1 raises the keyboard list above the chip', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-05 open'))
    const sheet = await openPythonScriptSheet(page)

    await sheet.locator('.cm-content').click()
    await page.keyboard.press('F1')
    await expect(popover(page)).toBeVisible()

    // PYRUN-18: the popover stands over the chip it belongs to.
    await expect(popover(page)).toHaveAttribute('data-side', 'top')
    const [popoverRect, chipRect, sheetRect] = await Promise.all([
      popover(page).boundingBox(),
      chip(sheet).boundingBox(),
      sheet.boundingBox(),
    ])
    expect(
      popoverRect!.y + popoverRect!.height,
      'the popover sits above the chip',
    ).toBeLessThanOrEqual(chipRect!.y + 1)

    // PYRUN-13: the heading, then every chord in order with its action.
    const heading = popover(page).locator('h3')
    await expect(heading).toHaveText('Keyboard')
    expect(
      await heading.evaluate((element) => globalThis.getComputedStyle(element).textTransform),
      'the heading reads KEYBOARD',
    ).toBe('uppercase')

    await expect(keyRows(page)).toHaveCount(SHORTCUTS.length)
    const listed = await keyRows(page).evaluateAll((rows) =>
      rows.map((row) => ({
        keys: Array.from(row.querySelectorAll('kbd')).map((key) => key.textContent ?? ''),
        action:
          row.querySelector('[data-testid="python-help-key-label"]')?.textContent ?? '',
      })),
    )
    expect(listed).toEqual(SHORTCUTS.map((shortcut) => ({ ...shortcut })))

    // The X rides the popover's top-right corner.
    const close = popover(page).getByRole('button', { name: 'Close help' })
    await expect(close).toBeVisible()
    const closeRect = (await close.boundingBox())!
    expect(closeRect.y - popoverRect!.y, 'the X is at the top').toBeLessThanOrEqual(
      CORNER_TOLERANCE_PX,
    )
    expect(
      popoverRect!.x + popoverRect!.width - (closeRect.x + closeRect.width),
      'the X is at the right',
    ).toBeLessThanOrEqual(CORNER_TOLERANCE_PX)

    // The tips are a link at the bottom, closed until it is asked.
    const tips = popover(page).getByRole('button', { name: 'Show tips' })
    await expect(tips).toHaveAttribute('aria-expanded', 'false')
    await expect(popover(page).locator('h4')).toHaveCount(0)
    const lastRowRect = (await keyRows(page).last().boundingBox())!
    const tipsRect = (await tips.boundingBox())!
    expect(tipsRect.y, 'the link sits under the shortcut list').toBeGreaterThanOrEqual(
      lastRowRect.y + lastRowRect.height,
    )

    // The script is still there around the popover.
    await expect(sheet.locator('.cm-content')).toBeVisible()
    expect(
      popoverRect!.x + popoverRect!.width,
      'the popover leaves the script beside it visible',
    ).toBeLessThan(sheetRect!.x + sheetRect!.width)
  })

  test('V-PYEDIT-05 dismiss: the chip opens it, Esc and a click outside close it', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-05 dismiss'))
    const sheet = await openPythonScriptSheet(page)

    await chip(sheet).click()
    await expect(popover(page)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect(sheet, 'Escape closes the help, not the sheet').toBeVisible()

    await chip(sheet).click()
    await expect(popover(page)).toBeVisible()

    await sheet.locator('[data-testid="value-editor-sheet-drag-handle"]').click()
    await expect(popover(page)).toBeHidden()
    await expect(sheet).toBeVisible()
  })

  test('V-PYEDIT-05 focus: closing the help gives the editor back', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-05 focus'))
    const sheet = await openPythonScriptSheet(page)

    await chip(sheet).click()
    await expect(popover(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover(page)).toBeHidden()
    await expect
      .poll(() => editorHasFocus(page), { message: 'Escape gives the editor back' })
      .toBe(true)

    await chip(sheet).click()
    await expect(popover(page)).toBeVisible()
    await sheet.locator('[data-testid="value-editor-sheet-drag-handle"]').click()
    await expect(popover(page)).toBeHidden()
    await expect
      .poll(() => editorHasFocus(page), { message: 'a click outside gives the editor back' })
      .toBe(true)
  })

  test('V-PYEDIT-05 keys: Ctrl+/ comments a line with # and Save keeps it; Ctrl+F finds and Esc closes find', async ({
    page,
    request,
  }) => {
    const testId = await seedAndOpenPythonTest(page, 'V-PYEDIT-05 keys')
    created.push(testId)
    const sheet = await openPythonScriptSheet(page)
    const lines = sheet.locator('.cm-line')
    const scriptLines = PYTHON_SCRIPT.split('\n')
    const last = scriptLines.length - 1
    const commented = scriptLines.map((line, index) => (index === last ? `# ${line}` : line))
    await expect(lines).toHaveText(scriptLines)

    await test.step('Ctrl+/ turns the line under the cursor into a # comment', async () => {
      await lines.nth(last).click()
      await page.keyboard.press('ControlOrMeta+/')
      await expect(lines).toHaveText(commented)
    })

    await test.step('Ctrl+F opens the find panel and Esc closes it, not the editor', async () => {
      await page.keyboard.press('ControlOrMeta+f')
      const find = sheet.locator('.cm-search')
      await expect(find).toBeVisible()
      await expect(find.locator('input[name="search"]')).toBeFocused()
      await page.keyboard.press('Escape')
      await expect(find).toHaveCount(0)
      await expect(sheet, 'Esc closed the find panel, not the editor').toBeVisible()
    })

    await test.step('Save keeps the commented line in the saved Test', async () => {
      const save = sheet.getByTestId('value-editor-save-button')
      await save.click()
      await expect(save).toBeDisabled()
      await sheet.getByTestId('value-editor-cancel-button').click()
      await expect(sheet).toBeHidden()
      await saveConfig(configSheet(page))
      await expect(saveBtn(page)).toBeEnabled()
      await saveBtn(page).click()
      await expect(saveBtn(page)).toBeDisabled({ timeout: 10_000 })
      const node = await getNode(request, testId, PYTHON_NODE_ID)
      expect(node.data.config.values.script).toBe(commented.join('\n'))
    })
  })

  test("V-PYEDIT-05 keys: Ctrl+G opens the Go to line prompt on the cursor's line", async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-05 go to line'))
    const sheet = await openPythonScriptSheet(page)
    const lines = sheet.locator('.cm-line')
    await expect(lines).toHaveCount(PYTHON_SCRIPT.split('\n').length)

    await lines.nth(3).click()
    await page.keyboard.press('ControlOrMeta+g')
    const prompt = sheet.locator('.cm-goto-line')
    await expect(prompt, 'Ctrl+G opens Go to line').toBeVisible()
    await expect(prompt).toContainText('Go to line')
    await expect(prompt.locator('input[name="line"]')).toBeFocused()
    await expect(prompt.locator('input[name="line"]')).toHaveValue('4')
    await expect(sheet.locator('.cm-search'), 'Ctrl+G is not find').toHaveCount(0)
  })
})
