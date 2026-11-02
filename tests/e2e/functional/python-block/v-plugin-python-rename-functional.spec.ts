/**
 * V-PLUGIN-PYTHON-RENAME: F2 rename in the Python script body
 * Wireframe: none
 * Design Decisions: PYRUN-19, PYRUN-20
 * REQ: REQ-3.4.1.2
 *
 * Pass Criteria:
 * 1. F2 on a symbol opens the rename box under that symbol, pre-filled with the
 *    current name and focused, with every occurrence marked and the hint reading
 *    exactly `Rename symbol · Enter to apply · Esc to cancel`.
 * 2. Renaming a LOCAL rewrites the script only: the persisted script carries the new
 *    name at both occurrences, while the Input Variable key and the Variable Exports
 *    row name are untouched.
 * 3. Renaming a Variable Exports row name rewrites the script AND the row: the
 *    persisted Test carries the new name in `values.script_variables` and as the
 *    `outputBindings` key, the binding still points at the same WAVE variable, and
 *    the old name is gone from the script, the exports list and the bindings.
 * 4. Renaming an Input Variable key rewrites the script occurrences and the
 *    `input_vars` key; the old key is gone.
 * 5. Enter applies every edit as ONE transaction, so a single Ctrl+Z puts the whole
 *    script back; Esc closes the box and changes nothing (Save stays disabled).
 * 6. An invalid new name shows the server's message inline, exactly
 *    `Invalid variable name: '1bad'`, and changes nothing.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openStringParamSheet } from '../../helpers/param-config'
import {
  deleteTest,
  openConfig,
  persistedNodes,
  saveConfig,
  saveWorkbench,
} from '../file-picker/picker'

const NODE = 'py-rename'
const RENAME_HINT = 'Rename symbol · Enter to apply · Esc to cancel'
const BAD_NAME_MESSAGE = "Invalid variable name: '1bad'"

const ORIGINAL_SCRIPT =
  "GREETING = 'hello'\nbase = 2\ndoubled = base * 2\npy_export = GREETING + str(doubled)\n"
const LOCAL_RENAMED =
  "GREETING = 'hello'\nbase = 2\ntrebled = base * 2\npy_export = GREETING + str(trebled)\n"
const EXPORT_RENAMED =
  "GREETING = 'hello'\nbase = 2\ndoubled = base * 2\npy_result = GREETING + str(doubled)\n"
const INPUT_RENAMED =
  "SALUTATION = 'hello'\nbase = 2\ndoubled = base * 2\npy_export = SALUTATION + str(doubled)\n"

/** 1-based line, 0-based column of the symbol each step renames. */
const AT_LOCAL = { line: 3, column: 3 }
const AT_EXPORT = { line: 4, column: 3 }
const AT_INPUT = { line: 1, column: 3 }

const createdTests: string[] = []

function loadFixture(): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-rename.json'), 'utf-8'),
  ) as Record<string, unknown>
}

/** Import the fixture, open the canvas, open the block config and its Script sheet. */
async function openScriptSheet(
  page: Page,
): Promise<{ testId: string; dialog: Locator; sheet: Locator }> {
  const testId = await importValidateAndNavigate(page, loadFixture())
  createdTests.push(testId)
  const dialog = await openConfig(page, NODE)
  const sheet = await openStringParamSheet(dialog, page, 'script')
  await expect(sheet.locator('.cm-content')).toBeVisible()
  return { testId, dialog, sheet }
}

/** The editor's text, line by line. Every line of these fixtures is rendered. */
async function editorText(sheet: Locator): Promise<string> {
  return sheet
    .locator('.cm-content')
    .first()
    .evaluate((el) =>
      Array.from(el.querySelectorAll('.cm-line'))
        .map((line) => line.textContent ?? '')
        .join('\n'),
    )
}

/** Put the cursor at a 1-based line and 0-based column with keys alone. */
async function placeCursor(
  page: Page,
  sheet: Locator,
  at: { line: number; column: number },
): Promise<void> {
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.press('Control+Home')
  for (let i = 1; i < at.line; i++) await page.keyboard.press('ArrowDown')
  for (let i = 0; i < at.column; i++) await page.keyboard.press('ArrowRight')
}

function renameBox(page: Page): Locator {
  return page.getByTestId('python-rename-box')
}

/** F2 at `at`, and the open box. */
async function openRename(
  page: Page,
  sheet: Locator,
  at: { line: number; column: number },
): Promise<Locator> {
  await placeCursor(page, sheet, at)
  await page.keyboard.press('F2')
  const box = renameBox(page)
  await expect(box).toBeVisible()
  return box
}

/** Type the new name and apply it. */
async function applyRename(page: Page, newName: string): Promise<void> {
  const input = renameBox(page).getByTestId('python-rename-input')
  // The box opens with the old name selected, so the new one is typed over it.
  await input.press('Control+a')
  await input.pressSequentially(newName)
  await expect(input).toHaveValue(newName)
  await input.press('Enter')
}

async function saveAndCloseSheet(sheet: Locator): Promise<void> {
  const save = sheet.getByTestId('value-editor-save-button')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled()
  await sheet.getByTestId('value-editor-cancel-button').click()
  await expect(sheet).toBeHidden()
}

/** Apply the config, persist the workbench, and read the block back from the server. */
async function persistAndRead(
  page: Page,
  dialog: Locator,
  testId: string,
): Promise<Record<string, any>> {
  await saveConfig(dialog)
  await saveWorkbench(page)
  return (await persistedNodes(page.request, testId))[NODE].config
}

test.describe('V-PLUGIN-PYTHON-RENAME: F2 rename (PYRUN-19)', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) await deleteTest(request, createdTests.pop() as string)
  })

  test('PYRUN-19: the box is anchored and pre-filled, Esc and a bad name change nothing, Enter is one undo step', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const { sheet } = await openScriptSheet(page)

    await test.step('F2 opens the box under the symbol, pre-filled, with every occurrence marked', async () => {
      const box = await openRename(page, sheet, AT_LOCAL)
      const input = box.getByTestId('python-rename-input')
      await expect(input).toHaveValue('doubled')
      await expect(input).toBeFocused()
      await expect(input).toHaveAttribute('aria-label', 'New name')
      await expect(box.getByTestId('python-rename-hint')).toHaveText(RENAME_HINT)

      const occurrences = sheet.locator('.cm-python-rename-occurrence')
      await expect(occurrences, 'both `doubled` occurrences are marked').toHaveCount(2)

      // The box is positioned after CodeMirror's next measure pass, so both reads retry.
      type Rect = { x: number; y: number; width: number; height: number }
      let symbol: Rect | null = null
      let anchored: Rect | null = null
      await expect(async () => {
        symbol = await occurrences.first().boundingBox()
        anchored = await box.boundingBox()
        expect(symbol, 'the marked symbol has a box').not.toBeNull()
        expect(anchored, 'the rename box has a box').not.toBeNull()
      }).toPass({ timeout: 10_000 })
      expect(
        anchored!.y,
        `the box sits under the symbol: box ${JSON.stringify(anchored)} vs symbol ${JSON.stringify(symbol)}`,
      ).toBeGreaterThanOrEqual(symbol!.y)
      expect(anchored!.y - (symbol!.y + symbol!.height)).toBeLessThanOrEqual(60)
      expect(
        Math.abs(anchored!.x - symbol!.x),
        `the box is anchored at the symbol horizontally: box ${JSON.stringify(anchored)} vs symbol ${JSON.stringify(symbol)}`,
      ).toBeLessThanOrEqual(160)
    })

    await test.step('Esc closes the box and changes nothing', async () => {
      await renameBox(page).getByTestId('python-rename-input').press('Escape')
      await expect(renameBox(page)).toBeHidden()
      await expect(sheet, 'Esc inside the box does not reach the sheet behind it').toBeVisible()
      expect(await editorText(sheet)).toBe(ORIGINAL_SCRIPT)
      await expect(
        sheet.getByTestId('value-editor-save-button'),
        'nothing changed, so Save stays disabled',
      ).toBeDisabled()
    })

    await test.step("an invalid name shows the server's message inline and changes nothing", async () => {
      await openRename(page, sheet, AT_LOCAL)
      await applyRename(page, '1bad')
      const error = renameBox(page).getByTestId('python-rename-error')
      await expect(error).toHaveText(BAD_NAME_MESSAGE, { timeout: 20_000 })
      await expect(error).toHaveAttribute('role', 'alert')
      await expect(renameBox(page), 'the box stays open on a refusal').toBeVisible()
      expect(await editorText(sheet)).toBe(ORIGINAL_SCRIPT)
      await expect(sheet.getByTestId('value-editor-save-button')).toBeDisabled()

      await renameBox(page).getByTestId('python-rename-input').press('Escape')
      await expect(renameBox(page)).toBeHidden()
    })

    await test.step('Enter applies every edit as one transaction that one Ctrl+Z undoes', async () => {
      await openRename(page, sheet, AT_LOCAL)
      await applyRename(page, 'trebled')
      await expect(renameBox(page)).toBeHidden({ timeout: 60_000 })
      await expect(async () => {
        expect(await editorText(sheet)).toBe(LOCAL_RENAMED)
      }).toPass({ timeout: 60_000 })

      await sheet.locator('.cm-content').first().focus()
      await page.keyboard.press('Control+z')
      await expect(async () => {
        expect(await editorText(sheet), 'one undo puts both occurrences back').toBe(ORIGINAL_SCRIPT)
      }).toPass({ timeout: 10_000 })
    })
  })

  test('PYRUN-19: renaming a local rewrites the script only', async ({ page }) => {
    test.setTimeout(180_000)
    const { testId, dialog, sheet } = await openScriptSheet(page)

    await openRename(page, sheet, AT_LOCAL)
    await applyRename(page, 'trebled')
    await expect(renameBox(page)).toBeHidden({ timeout: 60_000 })
    await expect(async () => {
      expect(await editorText(sheet)).toBe(LOCAL_RENAMED)
    }).toPass({ timeout: 60_000 })

    await test.step('the Variable Exports row name is untouched', async () => {
      await expect(dialog.getByTestId('output-list-name-0')).toHaveValue('py_export')
    })

    await saveAndCloseSheet(sheet)
    const config = await persistAndRead(page, dialog, testId)

    await test.step('the saved script carries the new local name and nothing else moved', async () => {
      expect(config.values.script).toBe(LOCAL_RENAMED)
      expect(Object.keys(config.values.input_vars)).toEqual(['GREETING'])
      expect(config.values.script_variables).toEqual(['py_export'])
      expect(config.outputBindings).toEqual({ py_export: 'export_target' })
    })
  })

  test('PYRUN-19: renaming a Variable Exports row name follows into the saved Test', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    const { testId, dialog, sheet } = await openScriptSheet(page)

    await openRename(page, sheet, AT_EXPORT)
    await expect(
      sheet.locator('.cm-python-rename-occurrence'),
      'the export name is written once',
    ).toHaveCount(1)
    await applyRename(page, 'py_result')
    await expect(renameBox(page)).toBeHidden({ timeout: 60_000 })
    await expect(async () => {
      expect(await editorText(sheet)).toBe(EXPORT_RENAMED)
    }).toPass({ timeout: 60_000 })

    await test.step('the Variable Exports row takes the new name straight away', async () => {
      await expect(dialog.getByTestId('output-list-name-0')).toHaveValue('py_result')
    })

    await saveAndCloseSheet(sheet)
    const config = await persistAndRead(page, dialog, testId)

    await test.step('the saved Test carries the new name and the old one is gone', async () => {
      expect(config.values.script).toBe(EXPORT_RENAMED)
      expect(config.values.script_variables).toEqual(['py_result'])
      expect(config.outputBindings).toEqual({ py_result: 'export_target' })
      expect(config.values.script).not.toContain('py_export')
      expect(JSON.stringify(config.values.script_variables)).not.toContain('py_export')
      expect(Object.keys(config.outputBindings)).not.toContain('py_export')
    })
  })

  test('PYRUN-19: renaming an Input Variable key follows into the saved Test', async ({ page }) => {
    test.setTimeout(180_000)
    const { testId, dialog, sheet } = await openScriptSheet(page)

    await openRename(page, sheet, AT_INPUT)
    await expect(
      sheet.locator('.cm-python-rename-occurrence'),
      'both `GREETING` occurrences are marked',
    ).toHaveCount(2)
    await applyRename(page, 'SALUTATION')
    await expect(renameBox(page)).toBeHidden({ timeout: 60_000 })
    await expect(async () => {
      expect(await editorText(sheet)).toBe(INPUT_RENAMED)
    }).toPass({ timeout: 60_000 })

    await saveAndCloseSheet(sheet)
    const config = await persistAndRead(page, dialog, testId)

    await test.step('the saved Test carries the new Input Variable key', async () => {
      expect(config.values.script).toBe(INPUT_RENAMED)
      expect(Object.keys(config.values.input_vars)).toEqual(['SALUTATION'])
      expect(config.values.input_vars.SALUTATION).toBe('hello')
      expect(config.values.script_variables).toEqual(['py_export'])
    })
  })
})
