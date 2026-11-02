/**
 * V-PYEDIT-02: Python script editor, syntax errors
 * Design Decisions: PYRUN-13, PYRUN-21
 * REQ: REQ-3.4.1.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * The strip's wording is the editor's own parser while the author types, and
 * the interpreter's on Save or Run, so only the SHAPE "Line {n}: {message}" and
 * the line numbers are asserted here.
 *
 * Pass Criteria:
 * 1. A script with two syntax errors underlines both lines, and only those.
 * 2. The strip above the footer is an alert reading the first message as
 *    "Line {n}: {message}" followed by the expander "(+1 more)".
 * 3. The expander lists both messages, each as "Line {n}: {message}".
 * 4. Save stays enabled with a syntax error.
 * 5. Run is enabled while the script parses and disabled once it does not.
 * 6. Saving and closing the sheet paints the block invalid on the canvas, and
 *    the badge names "Script has a syntax error on line {n}".
 */

import { test, expect, type Locator } from '../../helpers/playwright-fixtures'
import { saveConfig } from '../../functional/file-picker/picker'
import { configSheet } from '../../helpers/workbench'
import {
  PYTHON_NODE_ID,
  deletePythonTest,
  openPythonScriptSheet,
  seedAndOpenPythonTest,
  setPythonScript,
} from './python-seed'

// Two self-contained bad statements: tree-sitter reports one error per broken
// line and CPython reports the first of them, so both verdicts name line 2.
const BROKEN_SCRIPT = [
  'limit = threshold',
  'mean = = 1',
  'count = readings',
  'total = = 2',
].join('\n')

const BROKEN_LINES = [2, 4]
const FIRST_BROKEN_LINE = BROKEN_LINES[0]

const created: string[] = []

const strip = (sheet: Locator) => sheet.locator('[data-testid="value-editor-validation"]')
const moreTrigger = (sheet: Locator) => sheet.locator('[data-testid="value-editor-validation-more"]')
const saveButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-save-button"]')
const runButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-run-button"]')
const cancelButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-cancel-button"]')

/** The 1-based document lines carrying a syntax-error underline. */
function underlinedLines(sheet: Locator): Promise<number[]> {
  return sheet
    .locator('.cm-content')
    .evaluate((content) =>
      Array.from(content.querySelectorAll('.cm-line'))
        .map((line, index) => (line.querySelector('.cm-invalid-function') ? index + 1 : 0))
        .filter((line) => line > 0),
    )
}

test.describe('V-PYEDIT-02: syntax errors in the Python script editor', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PYEDIT-02 live: both lines underlined, the strip, its expander, Save live and Run dead', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-02 live'))
    const sheet = await openPythonScriptSheet(page)

    // The seeded script parses, so Run starts live and the strip is absent.
    await expect(runButton(sheet)).toBeEnabled()
    await expect(strip(sheet)).toHaveCount(0)

    await setPythonScript(page, sheet, BROKEN_SCRIPT)

    // PYRUN-13: the first message, then the count of the ones behind it.
    await expect(strip(sheet)).toBeVisible()
    await expect(strip(sheet)).toHaveAttribute('role', 'alert')
    await expect(strip(sheet)).toHaveText(
      new RegExp(String.raw`^Line ${FIRST_BROKEN_LINE}: \S.*\(\+1 more\)$`),
    )
    await expect(moreTrigger(sheet)).toHaveText('(+1 more)')

    expect(await underlinedLines(sheet), 'both broken lines are underlined').toEqual(BROKEN_LINES)

    // A syntax error never blocks Save; it always blocks Run.
    await expect(saveButton(sheet)).toBeEnabled()
    await expect(runButton(sheet)).toBeDisabled()

    await moreTrigger(sheet).click()
    const rows = page.locator('[data-testid="value-editor-validation-more-list"] > div')
    await expect(rows).toHaveCount(BROKEN_LINES.length)
    const texts = (await rows.allTextContents()).map((text) => text.trim())
    for (const [index, line] of BROKEN_LINES.entries()) {
      expect(texts[index], `message ${index + 1}`).toMatch(new RegExp(String.raw`^Line ${line}: \S`))
    }
  })

  test('V-PYEDIT-02 canvas: a saved broken script paints the block invalid', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-02 canvas'))
    const sheet = await openPythonScriptSheet(page)

    await setPythonScript(page, sheet, BROKEN_SCRIPT)
    await expect(strip(sheet)).toBeVisible()

    // PYRUN-20: Save applies and keeps the sheet open, then goes dead.
    await saveButton(sheet).click()
    await expect(saveButton(sheet)).toBeDisabled()
    await cancelButton(sheet).click()
    await expect(sheet).toBeHidden()
    await saveConfig(configSheet(page))

    const alert = page
      .locator(`[data-testid="workflow-node-${PYTHON_NODE_ID}"] [data-testid="node-validation-alert"]`)
      .first()
    await expect(alert).toBeVisible()
    await expect(alert).toHaveAttribute('aria-label', 'Configuration incomplete')

    await alert.hover()
    const tooltip = page.locator('[role="tooltip"]').last()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(`Script has a syntax error on line ${FIRST_BROKEN_LINE}`)
  })
})
