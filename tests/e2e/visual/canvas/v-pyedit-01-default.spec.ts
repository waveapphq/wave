/**
 * V-PYEDIT-01: Python script editor, default state
 * Design Decisions: PYRUN-13, PYRUN-20, PYRUN-21, FIELD-11
 * REQ: REQ-3.4.1.2
 *
 * Runs in the no-data project list. Each test seeds its own Test through
 * POST /tests and afterAll deletes it. Theme-agnostic DOM assertions.
 *
 * Pass Criteria:
 * 1. The footer's left side carries exactly one chip, F1 Help, and nothing else:
 *    no Kind, Format or View dropdown, no Format button and no metric.
 * 2. The footer's right side reads Close, Save, Run in that order, left to
 *    right, and Run is the only primary button.
 * 3. Save is disabled while the script is unchanged and enabled after a keystroke.
 * 4. Run is enabled while the script parses.
 * 5. Python mode offers no Kind dropdown, no Format dropdown and no pretty-print
 *    control, while an ordinary string row (Interpreter) offers Kind and Format.
 * 6. The editor numbers every line of the script and paints its Python tokens in
 *    a color other than the plain text color.
 * 7. The sheet opens at 720x460, and its maximize control (the four-corner frame, four inward corners while
 *    maximized) fills the viewport and restores the sheet to 720x460.
 */

import { test, expect, type Locator } from '../../helpers/playwright-fixtures'
import { openConfig } from '../../functional/file-picker/picker'
import { openStringParamSheet } from '../../helpers/param-config'
import {
  PYTHON_NODE_ID,
  PYTHON_SCRIPT,
  deletePythonTest,
  openPythonScriptSheet,
  seedAndOpenPythonTest,
} from './python-seed'

const SHEET_WIDTH = 720
const SHEET_HEIGHT = 460

/** Footer controls Python mode never offers on a script body. */
const NON_PYTHON_FOOTER_IDS = [
  'kind-dropdown',
  'format-dropdown',
  'view-dropdown',
  'value-editor-string-format-button',
  'value-editor-format-button',
  'value-editor-metric',
]

const created: string[] = []

const cancelButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-cancel-button"]')
const saveButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-save-button"]')
const runButton = (sheet: Locator) => sheet.locator('[data-testid="value-editor-run-button"]')

test.describe('V-PYEDIT-01: the default Python script editor', () => {
  test.afterAll(async ({ request }) => {
    for (const testId of created.splice(0)) await deletePythonTest(request, testId)
  })

  test('V-PYEDIT-01 footer: F1 Help alone on the left, Close / Save / Run on the right', async ({
    page,
  }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-01 footer'))
    const sheet = await openPythonScriptSheet(page)

    // PYRUN-13: the left side is the help chip and nothing else.
    const chip = sheet.locator('[data-testid="value-editor-help-chip"]')
    await expect(chip).toHaveCount(1)
    await expect(chip.locator('kbd')).toHaveText('F1')
    await expect(chip).toContainText('Help')
    for (const id of NON_PYTHON_FOOTER_IDS) {
      await expect(sheet.locator(`[data-testid="${id}"]`), id).toHaveCount(0)
    }

    const actions = sheet.locator(
      '[data-testid="value-editor-cancel-button"], [data-testid="value-editor-save-button"], [data-testid="value-editor-run-button"]',
    )
    expect(
      await actions.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid'))),
    ).toEqual([
      'value-editor-cancel-button',
      'value-editor-save-button',
      'value-editor-run-button',
    ])

    const [chipBox, closeBox, saveBox, runBox] = await Promise.all([
      chip.boundingBox(),
      cancelButton(sheet).boundingBox(),
      saveButton(sheet).boundingBox(),
      runButton(sheet).boundingBox(),
    ])
    expect(chipBox!.x + chipBox!.width, 'the chip sits left of Close').toBeLessThanOrEqual(closeBox!.x)
    expect(closeBox!.x, 'Close before Save').toBeLessThan(saveBox!.x)
    expect(saveBox!.x, 'Save before Run').toBeLessThan(runBox!.x)

    // PYRUN-21: Run is the primary; Close and Save are secondary.
    await expect(runButton(sheet)).toHaveClass(/\bbtn-primary\b/)
    await expect(saveButton(sheet)).toHaveClass(/\bbtn-secondary\b/)
    await expect(cancelButton(sheet)).toHaveClass(/\bbtn-secondary\b/)

    // PYRUN-20: Save wakes on the first keystroke; the script parses, so Run is live.
    await expect(saveButton(sheet)).toBeDisabled()
    await expect(runButton(sheet)).toBeEnabled()
    await expect(sheet.locator('[data-testid="value-editor-validation"]')).toHaveCount(0)

    await sheet.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.press('Enter')
    await expect(saveButton(sheet)).toBeEnabled()
  })

  test('V-PYEDIT-01 controls: no Kind, Format or pretty-print in Python mode', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-01 controls'))
    const config = await openConfig(page, PYTHON_NODE_ID)

    const script = await openStringParamSheet(config, page, 'script')
    for (const id of ['kind-dropdown', 'format-dropdown', 'value-editor-string-format-button']) {
      await expect(script.locator(`[data-testid="${id}"]`), id).toHaveCount(0)
    }
    await cancelButton(script).click()
    await expect(script).toBeHidden()

    // The same sheet on an ordinary string row still offers both dropdowns, so
    // their absence above is Python mode's doing.
    const interpreter = await openStringParamSheet(config, page, 'interpreter')
    await expect(interpreter.locator('[data-testid="kind-dropdown"]')).toHaveCount(1)
    await expect(interpreter.locator('[data-testid="format-dropdown"]')).toHaveCount(1)
    await expect(interpreter.locator('[data-testid="value-editor-help-chip"]')).toHaveCount(0)
    await expect(interpreter.locator('[data-testid="value-editor-run-button"]')).toHaveCount(0)
    await expect(interpreter.locator('button[aria-label="Maximize"]')).toHaveCount(0)
  })

  test('V-PYEDIT-01 editor: numbered lines and Python coloring', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-01 editor'))
    const sheet = await openPythonScriptSheet(page)

    const lineCount = PYTHON_SCRIPT.split('\n').length
    const numbers = await sheet
      .locator('.cm-lineNumbers .cm-gutterElement')
      .evaluateAll((els) => els.map((el) => (el.textContent ?? '').trim()).filter(Boolean))
    expect(numbers.slice(-lineCount)).toEqual(
      Array.from({ length: lineCount }, (_, i) => String(i + 1)),
    )

    // PYRUN-13: keywords, strings and numbers take their own color; identifiers,
    // operators and brackets stay in the plain text color.
    const colored = await sheet.locator('.cm-content').evaluate((content) => {
      const base = globalThis.getComputedStyle(content.querySelector('.cm-line') as Element).color
      return Array.from(content.querySelectorAll('.cm-line span'))
        .filter((el) => globalThis.getComputedStyle(el).color !== base)
        .map((el) => el.textContent ?? '')
    })
    expect(colored, 'the import keyword is colored').toContain('import')
    expect(colored, 'the comprehension keyword is colored').toContain('for')
    expect(colored, 'the literal 3 is colored').toContain('3')
  })

  test('V-PYEDIT-01 geometry: 720x460, maximized to the viewport and back', async ({ page }) => {
    created.push(await seedAndOpenPythonTest(page, 'V-PYEDIT-01 geometry'))
    const sheet = await openPythonScriptSheet(page)

    const opened = await sheet.boundingBox()
    expect(Math.round(opened!.width), 'opens 720 wide').toBe(SHEET_WIDTH)
    expect(Math.round(opened!.height), 'opens 460 tall').toBe(SHEET_HEIGHT)

    const maximize = sheet.locator('button[aria-label="Maximize"]')
    await expect(maximize).toHaveAttribute('aria-pressed', 'false')
    // FIELD-11: full size is the four-corner frame; four inward corners go back.
    await expect(maximize.locator('svg.lucide-maximize')).toHaveCount(1)
    await maximize.click()
    await expect(maximize).toHaveAttribute('aria-pressed', 'true')
    await expect(maximize.locator('svg.lucide-minimize')).toHaveCount(1)
    await expect(maximize.locator('svg.lucide-maximize')).toHaveCount(0)

    const viewport = page.viewportSize()!
    const full = await sheet.boundingBox()
    expect(full!.width, 'fills the viewport width').toBeGreaterThan(viewport.width * 0.85)
    expect(full!.height, 'fills the viewport height').toBeGreaterThan(viewport.height * 0.95)

    await maximize.click()
    await expect(maximize).toHaveAttribute('aria-pressed', 'false')
    await expect(maximize.locator('svg.lucide-maximize')).toHaveCount(1)
    const restored = await sheet.boundingBox()
    expect(Math.round(restored!.width), 'restores to 720 wide').toBe(SHEET_WIDTH)
    expect(Math.round(restored!.height), 'restores to 460 tall').toBe(SHEET_HEIGHT)
  })
})
