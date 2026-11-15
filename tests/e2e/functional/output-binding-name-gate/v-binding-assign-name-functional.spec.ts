/**
 * V-BINDING-ASSIGN-NAME (functional): an output row's Assign to box holds the name of a variable, so no value check
 * of the output's type runs on it and the only line under the row is its binding error.
 * Design Decisions: CANVAS-131, CANVAS-212
 * REQ: REQ-3.1.1.5
 *
 * Seeds (API, POST /tests; each Test is named `V-BINDING-ASSIGN-NAME <case> <id>` and deleted afterwards): an HTTP
 * Request Block with no binding; a Local Function Block whose Function declares the outputs `url` (string) and
 * `total` (integer); an HTTP Request Block in a Test that declares the string variable `code_text`.
 *
 * Pass Criteria:
 * 1. HTTP Request: `scode` typed into Status Code (Integer) and `took` into Response Time (Float) leave no line under
 *    either row (no `param-error-status_code`, no `param-error-response_time`, no alert), no Save note and Save on;
 *    the saved Block's `outputBindings` hold `status_code: scode` and `response_time: took`.
 * 2. Function Block: `final_url` typed into the output `url` and `n` into the Integer output `total` leave no line
 *    under either row (no URL line, no number line) and Save on; the saved Block holds both bindings.
 * 3. Status Code bound to the declared string variable `code_text` shows its binding error
 *    `Type mismatch: "code_text" is string, expected integer` at `field-error-status_code` as the one line under the
 *    row, the box points at it, and Save stays off with `Save is disabled: the settings have errors`.
 *
 * Phase: functional-workflow. Nothing is run: the Block window and the stored Test are the behavior.
 */

import { randomUUID } from 'node:crypto'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { openTest } from '../../helpers/fn-seed'
import {
  cleanUp,
  configOf,
  createTest,
  localFunctionBlock,
  logBlock,
  openBlockWindow,
  pluginBlock,
  saveBlockWindow,
  storedBlock,
  windowSave,
  type Rec,
} from '../../helpers/fn-block'
import { outputRow, rowError, settingsNote } from '../../helpers/config-sheet'
import { saveTest } from '../../helpers/workbench'

const SPEC = 'V-BINDING-ASSIGN-NAME'
const HTTP_ID = 'assign-name-http'
const FN_ID = 'assign-name-fn'
const SETTINGS_NOTE = 'Save is disabled: the settings have errors'
const MISMATCH = 'Type mismatch: "code_text" is string, expected integer'
const SUGGESTION_LIST = '[data-radix-popper-content-wrapper] [data-slot="command-list"]'

function testName(what: string): string {
  return `${SPEC} ${what} ${randomUUID().slice(0, 8)}`
}

function httpBlock(): Rec {
  return pluginBlock(HTTP_ID, 'HTTP Request', 'http-client', 'network', {
    values: { method: 'GET', url: 'https://example.com/assign-name', response_mode: 'body' },
  })
}

/** The Assign to box of an output row. */
function assignBox(sheet: Locator, output: string): Locator {
  return outputRow(sheet, output).getByRole('combobox', { name: /^Assign .+ to$/ })
}

/** Every line drawn under an output row: its error lines and its amber lines. */
function rowLines(sheet: Locator, output: string): Promise<string[]> {
  return outputRow(sheet, output).locator('[role="alert"], [data-testid^="param-warning-"] p').allInnerTexts()
}

/** Type a name no variable has into an output's Assign to box, then shut the suggestion list; the window stays open. */
async function typeNewName(page: Page, sheet: Locator, output: string, name: string): Promise<void> {
  const box = assignBox(sheet, output)
  await box.click()
  await box.fill(name)
  await expect(box).toHaveValue(name)
  // The list's hint reads the name back from the window's bindings, so the window holds it once the hint names it.
  const hint = page.getByTestId('output-new-var-hint')
  await expect(hint, `${output}: the window holds ${name}`).toHaveText(`“${name}” will be created as a new variable`)
  await box.press('Escape')
  await expect(hint).toHaveCount(0)
  await expect(sheet, 'Escape shuts only the suggestion list').toBeVisible()
}

/** No line under the output row: no value check of its type, no binding error. */
async function expectNoLines(sheet: Locator, output: string, what: string): Promise<void> {
  await expect.poll(() => rowLines(sheet, output), { message: `${what}: no line under the row` }).toEqual([])
  await expect(rowError(sheet, output), `${what}: no value check line`).toHaveCount(0)
}

test.describe('V-BINDING-ASSIGN-NAME (functional): an output row holds a variable name, not a value', () => {
  const testIds: string[] = []

  test.afterEach(async ({ request }) => {
    await cleanUp(request, testIds)
  })

  test('an Integer and a Float output of HTTP Request hold variable names with no line under them and save', async ({
    page,
    request,
  }) => {
    const testId = await createTest(request, { name: testName('http'), nodes: [httpBlock()] })
    testIds.push(testId)
    await openTest(page, testId)
    const sheet = await openBlockWindow(page, HTTP_ID)

    await test.step('scode into Status Code and took into Response Time: no line under either row, Save on', async () => {
      await typeNewName(page, sheet, 'status_code', 'scode')
      await typeNewName(page, sheet, 'response_time', 'took')
      await expectNoLines(sheet, 'status_code', 'Status Code (Integer) bound to scode')
      await expectNoLines(sheet, 'response_time', 'Response Time (Float) bound to took')
      await expect(settingsNote(sheet), 'no Save note').toHaveCount(0)
      await expect(windowSave(sheet)).toBeEnabled()
    })

    await test.step('the saved Block holds both bindings', async () => {
      await saveBlockWindow(sheet)
      await saveTest(page)
      const bindings = configOf(await storedBlock(request, testId, HTTP_ID)).outputBindings
      expect(bindings, 'the stored outputBindings').toMatchObject({ status_code: 'scode', response_time: 'took' })
    })
  })

  test('a Function Block output named url and an Integer output hold variable names with no line under them and save', async ({
    page,
    request,
  }) => {
    const testId = await createTest(request, {
      name: testName('function'),
      nodes: [
        localFunctionBlock(FN_ID, 'Totals_Fn', {
          nodes: [logBlock('assign-name-log', 'Print', "'totals'")],
          outputs: [
            { name: 'url', type: 'string' },
            { name: 'total', type: 'integer' },
          ],
        }),
      ],
    })
    testIds.push(testId)
    await openTest(page, testId)
    const sheet = await openBlockWindow(page, FN_ID)

    await test.step('final_url into url and n into total: no URL line, no number line, Save on', async () => {
      await typeNewName(page, sheet, 'url', 'final_url')
      await typeNewName(page, sheet, 'total', 'n')
      await expectNoLines(sheet, 'url', 'the output url bound to final_url')
      await expectNoLines(sheet, 'total', 'the Integer output total bound to n')
      await expect(settingsNote(sheet), 'no Save note').toHaveCount(0)
      await expect(windowSave(sheet)).toBeEnabled()
    })

    await test.step('the saved Function Block holds both bindings', async () => {
      await saveBlockWindow(sheet)
      await saveTest(page)
      const bindings = configOf(await storedBlock(request, testId, FN_ID)).outputBindings
      expect(bindings, 'the stored outputBindings').toMatchObject({ url: 'final_url', total: 'n' })
    })
  })

  test('a binding to a variable of the wrong type is the one line under the row and holds Save', async ({
    page,
    request,
  }) => {
    const testId = await createTest(request, {
      name: testName('mismatch'),
      nodes: [httpBlock()],
      variables: { code_text: { value: 'x', type: 'string', scope: 'test' } },
    })
    testIds.push(testId)
    await openTest(page, testId)
    const sheet = await openBlockWindow(page, HTTP_ID)
    const box = assignBox(sheet, 'status_code')
    const bindingError = sheet.getByTestId('field-error-status_code')

    await box.click()
    await box.fill('code_text')
    await expect(bindingError, 'the binding error under Status Code').toHaveText(MISMATCH)
    // A type mismatch leaves the list open; Escape shuts it and keeps the window.
    await expect(page.locator(SUGGESTION_LIST)).toBeVisible()
    await box.press('Escape')
    await expect(page.locator(SUGGESTION_LIST)).toHaveCount(0)
    await expect(sheet).toBeVisible()

    await expect
      .poll(() => rowLines(sheet, 'status_code'), { message: 'the binding error is the one line under Status Code' })
      .toEqual([MISMATCH])
    await expect(rowError(sheet, 'status_code'), 'no value check line beside the binding error').toHaveCount(0)
    await expect(bindingError).toHaveAttribute('role', 'alert')
    const errorId = await bindingError.getAttribute('id')
    expect(errorId, 'the binding error carries an id').toBeTruthy()
    await expect(box, 'the box points at its binding error').toHaveAttribute('aria-describedby', errorId as string)
    await expect(box).toHaveAttribute('aria-invalid', 'true')
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await expect(windowSave(sheet)).toBeDisabled()
  })
})
