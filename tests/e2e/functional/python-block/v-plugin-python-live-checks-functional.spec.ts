/**
 * PYCHK: Python editor live checks
 * Wireframe: none
 * Design Decisions: PYRUN-13, PYRUN-14, PYRUN-20, PYRUN-21
 * REQ: REQ-3.4.1.2, REQ-3.4.2.2
 *
 * Pass Criteria:
 * 1. An unknown name is underlined in the editor and listed under it: the called name reads
 *    "Function 'puts' is not recognized", a read name reads "Variable 'qwertyuiop' is not
 *    defined", and a near miss reads "Variable 'totl' not defined. Did you mean 'total'?".
 *    Save and Run stay enabled, and after the save the block carries no red badge.
 * 2. A wrong method name, a wrong argument count and an operator pair Python rejects on a
 *    typed Input Variable are listed the same way, the strip is the amber advisory one and
 *    not the red alert, and the block still carries no red badge.
 * 3. A star import and a namespace reached through `globals` turn the checks off: the same
 *    name that was flagged is flagged no more. While the script does not parse only the
 *    syntax errors show, the strip is the red alert one, Save stays enabled and Run is
 *    disabled.
 * 4. A Python block whose script carries a warning inside a Local Function leaves both the
 *    block and the enclosing Function without a red badge; a syntax error in the same place
 *    paints both.
 */

import { leaveExpressionEditor } from '../../helpers/code-editor'
import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { openStringParamSheet } from '../../helpers/param-config'
import { digIn, popToBreadcrumbSegment } from '../../helpers/workbench'
import { closeConfig, deleteTest, openConfig, saveConfig } from '../file-picker/picker'
import { newToken, withToken } from '../shell-blocks/shell-helpers'

const UNKNOWN_CALL = "Line 2: Function 'puts' is not recognized"
const UNKNOWN_READ = "Line 3: Variable 'qwertyuiop' is not defined"
const NEAR_MISS = "Line 4: Variable 'totl' not defined. Did you mean 'total'?"
const BAD_METHOD = "Line 1: 'shout' is not a valid method for type 'str'"
const BAD_ARITY = "Line 2: Method 'split' takes 0-2 arguments, got 3"
const BAD_OPERATOR = "Line 3: Cannot use '*' with Decimal and float"
const LONE_UNKNOWN = "Line 1: Variable 'qwertyuiop' is not defined"

const NAMES_SCRIPT = ["total = 1", "puts('ok')", 'print(qwertyuiop)', 'print(totl)', ''].join('\n')
const TYPED_SCRIPT = ['label.shout()', "label.split(',', 1, 2)", 'threshold * 1.5', ''].join('\n')
const PLAIN_UNKNOWN = ['print(qwertyuiop)', ''].join('\n')
const STAR_IMPORT = ['from math import *', 'print(qwertyuiop)', ''].join('\n')
const DYNAMIC_NAMESPACE = ['globals()', 'print(qwertyuiop)', ''].join('\n')
const DOES_NOT_PARSE = ['def f(:', '    pass', '', 'print(qwertyuiop)', ''].join('\n')

const createdTests: string[] = []

function loadFixture(token: string): Record<string, unknown> {
  const raw = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, 'fixture-live-checks.json'), 'utf-8'),
  ) as Record<string, unknown>
  return withToken(raw, token)
}

/** Replace the editor's whole document. insertText dispatches one input event, so
 *  CodeMirror's auto-indent and auto-close never reshape the script. */
async function setScript(page: Page, sheet: Locator, text: string): Promise<void> {
  await leaveExpressionEditor(sheet)
  await sheet.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
}

/** The joined text of every span the editor underlines with `className`. */
function underlined(sheet: Locator, className: string): Promise<string[]> {
  return sheet.locator(`.cm-content .${className}`).allTextContents()
}

function validationStrip(page: Page): Locator {
  return page.getByTestId('value-editor-validation')
}

/** The strip carries `messages[0]`; the expander opens on the rest. */
async function expectStripMessages(
  page: Page,
  messages: string[],
  timeout = 20_000,
): Promise<void> {
  const strip = validationStrip(page)
  await expect(strip).toContainText(messages[0], { timeout })
  const more = page.getByTestId('value-editor-validation-more')
  if (messages.length === 1) {
    await expect(more).toHaveCount(0)
    return
  }
  await expect(more).toHaveText(`(+${messages.length - 1} more)`)
  await more.click()
  const list = page.getByTestId('value-editor-validation-more-list')
  await expect(list).toBeVisible()
  for (const message of messages) await expect(list).toContainText(message)
  await more.click()
  await expect(list).toHaveCount(0)
}

/** PYRUN-13: a finding is a warning, so the strip is the amber advisory one. */
async function expectAdvisoryStrip(page: Page): Promise<void> {
  const strip = validationStrip(page)
  await expect(strip).not.toHaveAttribute('role', 'alert')
  await expect(strip).toHaveClass(/amber/)
  await expect(strip).not.toHaveClass(/destructive/)
}

/** A syntax error is an error, so the strip is the red alert one. */
async function expectAlertStrip(page: Page): Promise<void> {
  const strip = validationStrip(page)
  await expect(strip).toHaveAttribute('role', 'alert')
  await expect(strip).toHaveClass(/destructive/)
}

function nodeAlert(page: Page, nodeId: string): Locator {
  return page.locator(
    `[data-testid="workflow-node-${nodeId}"] [data-testid="node-validation-alert"]`,
  )
}

/** Apply the draft and close the sheet; Save goes dead once applied (PYRUN-20). */
async function saveAndClose(page: Page, sheet: Locator): Promise<void> {
  await leaveExpressionEditor(sheet)
  const save = sheet.getByTestId('value-editor-save-button')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled()
  await sheet.getByTestId('value-editor-cancel-button').click()
  await expect(sheet).toBeHidden()
}

test.describe('PYCHK: the Python editor flags names, methods and operators while the author types', () => {
  test.afterAll(async ({ request }) => {
    while (createdTests.length > 0) {
      await deleteTest(request, createdTests.pop() as string)
    }
  })

  test('PYCHK: unknown names, typed Input Variables, and the stand-down for a star import, a dynamic namespace or a script that does not parse', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidateAndNavigate(page, loadFixture(newToken()))
    createdTests.push(testId)

    await test.step('an unknown name is underlined and listed, and blocks neither Save nor Run', async () => {
      const dialog = await openConfig(page, 'py-names')
      const sheet = await openStringParamSheet(dialog, page, 'script')
      await setScript(page, sheet, NAMES_SCRIPT)

      await expectStripMessages(page, [UNKNOWN_CALL, UNKNOWN_READ, NEAR_MISS])
      await expectAdvisoryStrip(page)
      await expect
        .poll(async () => (await underlined(sheet, 'cm-invalid-function')).join(' '))
        .toBe('puts')
      await expect
        .poll(async () => (await underlined(sheet, 'cm-unknown-variable')).join(' '))
        .toBe('qwertyuiop totl')

      await expect(sheet.getByTestId('value-editor-save-button')).toBeEnabled()
      await expect(sheet.getByTestId('value-editor-run-button')).toBeEnabled()

      await saveAndClose(page, sheet)
      await saveConfig(dialog)
      await expect(nodeAlert(page, 'py-names')).toHaveCount(0)
    })

    await test.step('a wrong method, a wrong argument count and a rejected operator pair are the same kind of warning', async () => {
      const dialog = await openConfig(page, 'py-typed')
      const sheet = await openStringParamSheet(dialog, page, 'script')
      await setScript(page, sheet, TYPED_SCRIPT)

      await expectStripMessages(page, [BAD_METHOD, BAD_ARITY, BAD_OPERATOR])
      await expectAdvisoryStrip(page)
      await expect
        .poll(async () => (await underlined(sheet, 'cm-invalid-function')).join(' '))
        .toBe('shout split *')

      await expect(sheet.getByTestId('value-editor-save-button')).toBeEnabled()
      await expect(sheet.getByTestId('value-editor-run-button')).toBeEnabled()

      await saveAndClose(page, sheet)
      await saveConfig(dialog)
      await expect(nodeAlert(page, 'py-typed')).toHaveCount(0)
    })

    await test.step('a star import and a dynamic namespace turn the checks off', async () => {
      const dialog = await openConfig(page, 'py-dynamic')
      const sheet = await openStringParamSheet(dialog, page, 'script')

      // The strip holds its last parse until the next one publishes, so it has to come
      // back between the two stand-down scripts for their empty strip to mean anything.
      await setScript(page, sheet, PLAIN_UNKNOWN)
      await expectStripMessages(page, [LONE_UNKNOWN])

      await setScript(page, sheet, STAR_IMPORT)
      await expect(validationStrip(page)).toHaveCount(0)
      await expect(sheet.locator('.cm-content .cm-unknown-variable')).toHaveCount(0)

      await setScript(page, sheet, PLAIN_UNKNOWN)
      await expectStripMessages(page, [LONE_UNKNOWN])

      await setScript(page, sheet, DYNAMIC_NAMESPACE)
      await expect(validationStrip(page)).toHaveCount(0)
      await expect(sheet.locator('.cm-content .cm-unknown-variable')).toHaveCount(0)

      await test.step('a script that does not parse shows only its syntax errors', async () => {
        await setScript(page, sheet, DOES_NOT_PARSE)
        await expectAlertStrip(page)
        const strip = validationStrip(page)
        await expect(strip).toContainText(/^Line \d+: /)
        await expect(strip).not.toContainText('is not defined')
        const more = page.getByTestId('value-editor-validation-more')
        if ((await more.count()) > 0) {
          await more.click()
          const list = page.getByTestId('value-editor-validation-more-list')
          await expect(list).toBeVisible()
          await expect(list).not.toContainText('is not defined')
          await more.click()
          await expect(list).toHaveCount(0)
        }
        await expect(sheet.getByTestId('value-editor-save-button')).toBeEnabled()
        await expect(sheet.getByTestId('value-editor-run-button')).toBeDisabled()
      })

      await leaveExpressionEditor(sheet)
      await sheet.getByTestId('value-editor-cancel-button').click()
      await page.getByTestId('value-editor-unsaved-discard-button').click()
      await expect(sheet).toBeHidden()
      await closeConfig(dialog)
    })
  })

  test('PYCHK: a warning inside a Local Function leaves the Function clean, an error paints it', async ({
    page,
  }) => {
    test.setTimeout(240_000)
    const testId = await importValidateAndNavigate(page, loadFixture(newToken()))
    createdTests.push(testId)

    await test.step('a warning in the body marks neither the block nor the Function', async () => {
      await digIn(page, 'fn-local')
      const dialog = await openConfig(page, 'py-inner')
      const sheet = await openStringParamSheet(dialog, page, 'script')
      await setScript(page, sheet, PLAIN_UNKNOWN)
      await expectStripMessages(page, [LONE_UNKNOWN])
      await expectAdvisoryStrip(page)
      await saveAndClose(page, sheet)
      await saveConfig(dialog)

      await expect(nodeAlert(page, 'py-inner')).toHaveCount(0)
      await popToBreadcrumbSegment(page, /PYCHK/)
      await expect(page.locator('[data-testid="workflow-node-fn-local"]')).toBeVisible()
      await expect(nodeAlert(page, 'fn-local')).toHaveCount(0)
    })

    await test.step('a syntax error in the same place paints both', async () => {
      await digIn(page, 'fn-local')
      const dialog = await openConfig(page, 'py-inner')
      const sheet = await openStringParamSheet(dialog, page, 'script')
      await setScript(page, sheet, DOES_NOT_PARSE)
      await expectAlertStrip(page)
      await saveAndClose(page, sheet)
      await saveConfig(dialog)

      await expect(nodeAlert(page, 'py-inner')).toHaveCount(1)
      await popToBreadcrumbSegment(page, /PYCHK/)
      await expect(page.locator('[data-testid="workflow-node-fn-local"]')).toBeVisible()
      await expect(nodeAlert(page, 'fn-local')).toHaveCount(1)
    })
  })
})
