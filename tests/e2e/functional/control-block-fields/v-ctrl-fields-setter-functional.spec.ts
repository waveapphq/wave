/**
 * V-CTRL-FIELDS-SETTER: Variable Setter rows on the one value field, from the window to the run
 * Design Decisions: VMGR-83, VARSET-7, VARSET-8, FIELD-5
 * REQ: REQ-3.4.1.14, REQ-3.1.3.19, REQ-3.1.3.21, REQ-3.1.1.5
 *
 * `fixture-setter.json`: the Setter `Set run values` with the rows `greeting` (text), `next_attempt`
 * ({x} `attempt + 1`), `summary` (the text `Run {{ run_id }} done`), `api_token` (secret text),
 * `host_list` (a list whose third entry is {x} `backup_host`), `limits` (a map), `retries` (3),
 * `port` (secret integer) and `vault_keys` (secret list); the Local Function `Set_Out` whose body
 * Setter writes its output `out` = 5; a Log printing each variable. Each test imports its own copy.
 *
 * Pass Criteria:
 * 1. Literal text, number and the null button: the run logs (DEBUG) `Set variable 'greeting' =
 *    'hello world' (scope: test)`, `Set variable 'retries' = 3 (scope: test)` and, for the row
 *    `last_error` added in the window and set by its null button, `Set variable 'last_error' = null
 *    (scope: test)`.
 * 2. The {x} row `attempt + 1` runs as an expression: `Set variable 'next_attempt' = 2 (scope: test)`.
 * 3. Template: the Edit value sheet of `summary` offers Literal and Template; Template picked there is
 *    stored, and the run logs `Set variable 'summary' = 'Run 7 done' (scope: test)`.
 * 4. The {x} third entry of `host_list` resolves at run to `backup_host`; the list sheet offers no
 *    Template.
 * 5. Secret row: after Save the row shows the masked face, a button named `api_token: Edit protected
 *    value`, no expand and its {x}; the button asks `Edit Protected Value?` with Cancel and Delete & Edit;
 *    the console shows the value as `********` and never the value itself.
 * 6. A fresh Setter opens with a nameless row showing `Name is required`; its {x} editor is titled
 *    `Edit expression`.
 * 7. Two rows' sheets are open at once, and each takes keyboard focus in its editor as it opens.
 * 8. A type change on a filled new row asks `Change variable type?`; Boolean clears the Secret tick and
 *    disables the box.
 * 9. With the window open and untouched, changing `next_attempt`'s declared type in the Variable
 *    Manager shows the new type on the row; the Save stores the type on the variable only and the run
 *    sets a float.
 * 10. The Setter inside the Function logs `Set variable 'out' = 5 (scope: function)` and the Function
 *    output reaches `fn_out`.
 * 11. A blank {x} value shows `Value is required` under the box and holds Save with the footer note.
 * 12. Stored node data: `expressionFields` holds `variables.next_attempt` and `variables.host_list.2`,
 *    `templateFields` holds `variables.summary`, `config.secretFields` holds `variables.api_token`;
 *    no `variableExpressionKeys`, `variableTemplateKeys`, `variableTypes`, `variableElementTypes`,
 *    `config.variableSecretKeys`; element types only for list and map rows; the secret stays sealed.
 * 13. After the run, by keyboard: Delete & Edit on `api_token` opens no sheet and leaves its value box
 *    empty with focus; Delete & Edit on the list secret `vault_keys` empties it and opens its sheet with
 *    focus inside; Escape closes the sheet and focus is on that row's value box, not the page body.
 *    The window closes without Save and the stored values stay.
 * 14. Delete & Edit on the stored text secret, a typed value and Save: the stored value is sealed and
 *    holds the typed text.
 * 15. Delete & Edit on the stored integer secret `port`: the box shows `0` with focus and Save is
 *    enabled; `8080` and Save store with no refusal, sealed.
 * 16. With the sheets of two rows open and text typed in the second, deleting the second row asks
 *    Keep Editing or Close; Keep Editing keeps both; Close removes the row and its sheet, the first
 *    row's sheet stays open and its Save writes the first row.
 * 17. Each row's {x} is reachable by role and name `<row name> expression mode`, with its pressed
 *    state, and pressing it by that name switches the row.
 * Outcome: the runs pass.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { dragPaletteItemToCanvas, expandPalette, waitForCanvasLoad } from '../../helpers/canvas'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import {
  getActiveSessionId,
  getSessionVariables,
  importValidateAndNavigate,
  sessionValue,
} from '../../helpers/fixture-import'
import { expectNodeStatus, finishRun, startRun } from '../../helpers/k8s-run'
import {
  expectConsoleLine,
  formatEntries,
  getLogEntries,
  setConsoleMinimumLevel,
  type LogEntry,
} from '../../helpers/log-reader'
import { answerSwitch, SWITCH_TO_EXPRESSION_TITLE, switchWarning } from '../../helpers/value-field'
import { expandVariableManager, openEditWindow, retypeInWindow, saveWindow } from '../../helpers/variable-create'
import { canvasBlockIds, openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'

const SETTER = '86ae114b-0ba4-42ab-b235-282b849a063f'
const FUNCTION_BLOCK = 'afb0667f-28f0-4816-b7d3-c5c7ffffff65'
const LOG = '83638a07-a412-4938-865b-29e075398839'

const ROW = {
  greeting: 0,
  next_attempt: 1,
  summary: 2,
  api_token: 3,
  host_list: 4,
  limits: 5,
  retries: 6,
  port: 7,
  vault_keys: 8,
} as const
const ADDED_ROW = 9

const STORED_TOKEN = 'tok-setter-4471-qz'
const TYPED_TOKEN = 'tok-typed-9035-qz'
const RAW_SECRETS = [STORED_TOKEN, 'k-alpha-7731', 'k-beta-2290', '8443']
const SEALED = /^wave:enc:v1:[A-Za-z0-9+/=_-]+$/
const MASK = '********'
const LOG_MARKER = 'vars greeting='
const OLD_KEYS = ['variableExpressionKeys', 'variableTemplateKeys', 'variableTypes', 'variableElementTypes']
const ROW_TYPE_PLACES = ['variables.host_list', 'variables.limits', 'variables.vault_keys']
const SAVE_HELD_NOTE = 'Save is disabled: the settings have errors'

const MASKING_ALL_OFF = {
  run_output: false,
  test_variables: false,
  shared_variables: false,
  credential_inputs: false,
}

type Fixture = { name: string; [key: string]: unknown }

interface StoredSetterData {
  expressionFields?: string[]
  templateFields?: string[]
  elementTypes?: Record<string, unknown>
  config: { values: { variables: Record<string, unknown> }; secretFields?: string[]; [key: string]: unknown }
  [key: string]: unknown
}

interface StoredTest {
  workflow: { nodes: Array<{ id: string; data: StoredSetterData }> }
  variables: Record<string, { type?: string; value?: unknown }>
}

function fixtureNamed(n: number): Fixture {
  const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixture-setter.json'), 'utf-8')) as Fixture
  fixture.name = `zz-ctrl-fields-setter-${n}`
  return fixture
}

// ---------------------------------------------------------------------------
// The window, its rows and its sheets
// ---------------------------------------------------------------------------

const valueBox = (sheet: Locator, row: number): Locator => sheet.getByTestId(`param-input-varset-value-${row}`)
const expandButton = (sheet: Locator, row: number): Locator => sheet.getByTestId(`param-expand-varset-value-${row}`)
const rowToggle = (sheet: Locator, row: number): Locator => sheet.getByTestId(`varset-expression-toggle-${row}`)
const valueError = (sheet: Locator, row: number): Locator => sheet.getByTestId(`param-error-varset-value-${row}`)
const nameBox = (sheet: Locator, row: number): Locator => sheet.getByTestId(`varset-name-input-${row}`)
const secretBox = (sheet: Locator, row: number): Locator => sheet.getByTestId(`varset-secret-checkbox-${row}`)
const typeSelect = (sheet: Locator, row: number): Locator => sheet.getByTestId(`varset-type-select-${row}`)
const windowSave = (sheet: Locator): Locator => sheet.getByRole('button', { name: 'Save', exact: true })
const maskedButton = (sheet: Locator, row: string): Locator =>
  sheet.getByRole('button', { name: `${row}: Edit protected value`, exact: true })
const editQuestion = (page: Page): Locator => page.getByRole('dialog', { name: 'Edit Protected Value?' })
const valueSheets = (page: Page): Locator => page.getByTestId('value-editor-sheet')
const sheetEditor = (scope: Locator | Page, row: string): Locator => scope.locator(`.cm-content[aria-label="${row}"]`)
const rowSheet = (page: Page, row: string): Locator => valueSheets(page).filter({ has: sheetEditor(page, row) })
const unsavedQuestion = (page: Page): Locator => page.getByTestId('unsaved-changes-dialog')

const hasFocus = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => element === document.activeElement)

const holdsFocusInside = (target: Locator): Promise<boolean> =>
  target.evaluate((element) => element.contains(document.activeElement))

const focusIsOnPageBody = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.activeElement === null || document.activeElement === document.body)

/** Whether `target` holds keyboard focus within a few seconds; a later assertion reports it. */
async function focusedWithin(target: Locator): Promise<boolean> {
  return expect(target)
    .toBeFocused({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
}

/** Whether `target` shows `text` within a few seconds; a later assertion reports it. */
async function showsWithin(target: Locator, text: string): Promise<boolean> {
  return expect(target)
    .toHaveText(text, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false)
}

/** Open a row's Edit value sheet from its expand button with the keyboard. */
async function openRowSheet(page: Page, sheet: Locator, row: number): Promise<void> {
  await expandButton(sheet, row).focus()
  await page.keyboard.press('Enter')
}

/** Tab from `start` until `target` holds keyboard focus. */
async function tabTo(page: Page, start: Locator, target: Locator): Promise<void> {
  await start.focus()
  for (let pressed = 0; pressed < 4 && !(await hasFocus(target)); pressed += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(target, 'Tab reaches the control').toBeFocused()
}

/** Ask `Edit Protected Value?` with Enter on the focused masked field. */
async function askWithEnter(page: Page): Promise<void> {
  await page.keyboard.press('Enter')
  const question = editQuestion(page)
  await expect(question).toBeVisible()
  await expect.poll(() => holdsFocusInside(question)).toBe(true)
}

/** Answer the question with the keyboard: Tab to the named button, then Enter. */
async function answerWithKeyboard(page: Page, answer: 'Cancel' | 'Delete & Edit'): Promise<void> {
  const button = editQuestion(page).getByRole('button', { name: answer, exact: true })
  for (let pressed = 0; pressed < 3 && !(await hasFocus(button)); pressed += 1) {
    await page.keyboard.press('Tab')
  }
  await expect(button, `Tab reaches "${answer}"`).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(editQuestion(page)).toHaveCount(0)
}

/** Answer `Delete & Edit` with a click. */
async function deleteAndEdit(page: Page, sheet: Locator, row: string): Promise<void> {
  await maskedButton(sheet, row).click()
  await editQuestion(page).getByRole('button', { name: 'Delete & Edit', exact: true }).click()
  await expect(editQuestion(page)).toHaveCount(0)
}

/** Replace the text of a sheet's editor. */
async function typeInSheet(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
}

/** Close the window with Cancel, answering Close when it asks about its changes. */
async function closeWithoutSave(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  const question = unsavedQuestion(page)
  await expect(async () => {
    if (await question.isVisible()) return
    await expect(sheet).toHaveCount(0, { timeout: 500 })
  }).toPass({ timeout: 10_000 })
  if (await question.isVisible()) {
    await question.getByTestId('unsaved-close').click()
    await expect(question).toHaveCount(0)
  }
  await expect(sheet).toHaveCount(0)
}

// ---------------------------------------------------------------------------
// The stored Test, the run
// ---------------------------------------------------------------------------

async function storedTest(page: Page, testId: string): Promise<StoredTest> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}`)
  expect(resp.ok(), `GET /tests/${testId}: ${resp.status()}`).toBeTruthy()
  const body = await resp.json()
  return (body.data ?? body) as StoredTest
}

async function storedSetter(page: Page, testId: string): Promise<StoredSetterData> {
  const node = (await storedTest(page, testId)).workflow.nodes.find((candidate) => candidate.id === SETTER)
  expect(node, 'the saved Test holds the Setter').toBeTruthy()
  return (node as { data: StoredSetterData }).data
}

/** The Setter rows with every secret decrypted, read from the plaintext export. */
async function plaintextRows(page: Page, testId: string): Promise<Record<string, unknown>> {
  const resp = await page.request.get(`${BACKEND_URL}/tests/${testId}/export?format=json&secrets=plaintext`)
  expect(resp.ok(), `GET /tests/${testId}/export: ${resp.status()}`).toBeTruthy()
  const parsed = JSON.parse(await resp.text()) as StoredTest
  const node = parsed.workflow.nodes.find((candidate) => candidate.id === SETTER)
  expect(node, 'the exported Test holds the Setter').toBeTruthy()
  return (node as { data: StoredSetterData }).data.config.values.variables
}

/** Run the Test with the console at DEBUG; asserts it passes and returns the console entries. */
async function runPassed(page: Page): Promise<LogEntry[]> {
  await setConsoleMinimumLevel(page, 'DEBUG')
  const status = await startRun(page)
  await finishRun(page, status, LOG_MARKER)
  return getLogEntries(page)
}

let testId = ''

test.describe('V-CTRL-FIELDS-SETTER: Variable Setter rows on the one value field', () => {
  test.beforeEach(async ({ page }) => {
    // A stored secret shows masked only while the unmask settings are off.
    await page.request.put(`${BACKEND_URL}/admin/secret-masking`, { data: MASKING_ALL_OFF })
  })

  test.afterEach(async ({ page }) => {
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await page.request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('every row form saves in the stored shape and runs; a stored secret edits fresh after the run', async ({
    page,
  }) => {
    test.setTimeout(280_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(1))
    const imported = await storedSetter(page, testId)
    expect(String(imported.config.values.variables.api_token), 'the import sealed the secret').toMatch(SEALED)

    let sheet = await openBlockSheet(page, SETTER)
    await expect(nameBox(sheet, ROW.vault_keys)).toHaveValue('vault_keys')

    await test.step('3. the summary sheet offers Literal and Template; Template is picked there', async () => {
      await openRowSheet(page, sheet, ROW.summary)
      const summarySheet = rowSheet(page, 'summary')
      await expect(summarySheet).toHaveCount(1)
      const kind = summarySheet.getByTestId('kind-dropdown')
      await expect(kind).toHaveText('Literal')
      await kind.click()
      await expect(page.getByRole('option')).toHaveText(['Literal', 'Template'])
      await page.getByRole('option', { name: 'Template', exact: true }).click()
      await expect(kind).toHaveText('Template')
      await summarySheet.getByTestId('value-editor-save-button').click()
      await summarySheet.getByTestId('value-editor-cancel-button').click()
      await expect(rowSheet(page, 'summary')).toHaveCount(0)
      await expect(valueBox(sheet, ROW.summary).locator('.cm-content'), 'the row shows the Template face').toHaveText(
        'Run {{ run_id }} done',
      )
      await expect(rowToggle(sheet, ROW.summary)).toHaveAttribute('aria-pressed', 'false')
      await expect(valueSheets(page)).toHaveCount(0)
    })

    await test.step('4. the host_list sheet offers no Template for its entries', async () => {
      await openRowSheet(page, sheet, ROW.host_list)
      const listSheet = valueSheets(page)
      await expect(listSheet).toHaveCount(1)
      await expect(listSheet.getByTestId('value-editor-type-badge')).toHaveText('array')
      await expect(listSheet.getByTestId('kind-dropdown')).toHaveCount(0)
      await expect(listSheet.getByText('Template', { exact: true })).toHaveCount(0)
      await listSheet.getByTestId('value-editor-cancel-button').click()
      await expect(valueSheets(page)).toHaveCount(0)
    })

    await test.step('1. the added row last_error takes text, then the null button sets it to null', async () => {
      await sheet.getByTestId('varset-add-button').click()
      const name = nameBox(sheet, ADDED_ROW)
      await expect(name).toBeFocused()
      await name.fill('last_error')
      await secretBox(sheet, ADDED_ROW).focus()
      await expect(typeSelect(sheet, ADDED_ROW)).toHaveText('String')
      const box = valueBox(sheet, ADDED_ROW)
      await box.click()
      await page.keyboard.type('boom')
      await expect(box).toHaveValue('boom')
      const nullButton = sheet.getByRole('button', { name: 'Set last_error to null', exact: true })
      await expect(nullButton).toHaveAttribute('aria-pressed', 'false')
      await nullButton.click()
      await expect(nullButton).toHaveAttribute('aria-pressed', 'true')
      await expect(box).toHaveValue('')
    })

    await test.step('12. Save writes the rows and their marks in the stored shape', async () => {
      await saveBlockSheet(sheet)
      await saveTest(page)
      const data = await storedSetter(page, testId)
      expect(data.expressionFields ?? []).toEqual(
        expect.arrayContaining(['variables.next_attempt', 'variables.host_list.2']),
      )
      expect(data.templateFields).toEqual(['variables.summary'])
      expect(data.config.secretFields ?? []).toEqual(expect.arrayContaining(['variables.api_token']))
      for (const key of OLD_KEYS) expect(data, `no ${key} on the Block`).not.toHaveProperty(key)
      expect(data.config, 'no variableSecretKeys on the Block').not.toHaveProperty('variableSecretKeys')
      const placesWithTypes = Object.keys(data.elementTypes ?? {})
      expect(
        placesWithTypes.filter((place) => !ROW_TYPE_PLACES.includes(place)),
        'element types are stored for list and map rows only',
      ).toEqual([])
      const rows = data.config.values.variables
      expect(rows.greeting).toBe('hello world')
      expect(rows.next_attempt).toBe('attempt + 1')
      expect(rows.summary).toBe('Run {{ run_id }} done')
      expect(rows.host_list).toEqual(['web-1', 'web-2', 'backup_host'])
      expect(rows.limits).toEqual({ cpu: 2, mem: '4Gi' })
      expect(rows.retries).toBe(3)
      expect(rows).toHaveProperty('last_error', null)
      expect(String(rows.api_token), 'the secret stays sealed').toMatch(SEALED)
      expect((await plaintextRows(page, testId)).api_token).toBe(STORED_TOKEN)
    })

    await test.step('5. after Save the secret row is masked, and its button asks before it edits', async () => {
      sheet = await openBlockSheet(page, SETTER)
      const masked = maskedButton(sheet, 'api_token')
      await expect(masked).toHaveCount(1)
      await expect(expandButton(sheet, ROW.api_token), 'a masked row has no expand').toHaveCount(0)
      await expect(rowToggle(sheet, ROW.api_token)).toBeVisible()
      await masked.click()
      const question = editQuestion(page)
      await expect(question).toBeVisible()
      await expect(question.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(1)
      await expect(question.getByRole('button', { name: 'Delete & Edit', exact: true })).toHaveCount(1)
      await question.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(masked, 'Cancel keeps the value masked').toHaveCount(1)
      await expect(valueSheets(page)).toHaveCount(0)
      await closeWithoutSave(page, sheet)
    })

    const entries = await runPassed(page)

    await test.step('1-4, 10. each row is set as its form says', async () => {
      expectConsoleLine(entries, 'DEBUG', "Set variable 'greeting' = 'hello world' (scope: test)")
      expectConsoleLine(entries, 'DEBUG', "Set variable 'retries' = 3 (scope: test)")
      expectConsoleLine(entries, 'DEBUG', "Set variable 'last_error' = null (scope: test)")
      expectConsoleLine(entries, 'DEBUG', "Set variable 'next_attempt' = 2 (scope: test)")
      expectConsoleLine(entries, 'DEBUG', "Set variable 'summary' = 'Run 7 done' (scope: test)")
      expectConsoleLine(entries, 'DEBUG', `Set variable 'host_list' = ["web-1","web-2","db-backup-1"] (scope: test)`)
      expectConsoleLine(entries, 'DEBUG', "Set variable 'out' = 5 (scope: function)")
      await expectNodeStatus(page, SETTER, 'success')
      await expectNodeStatus(page, FUNCTION_BLOCK, 'success')
      await expectNodeStatus(page, LOG, 'success')

      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(sessionValue(variables, 'greeting')).toBe('hello world')
      expect(sessionValue(variables, 'next_attempt')).toBe(2)
      expect(sessionValue(variables, 'summary')).toBe('Run 7 done')
      expect(sessionValue(variables, 'host_list')).toEqual(['web-1', 'web-2', 'db-backup-1'])
      expect(sessionValue(variables, 'limits')).toEqual({ cpu: 2, mem: '4Gi' })
      expect(sessionValue(variables, 'retries')).toBe(3)
      expect(sessionValue(variables, 'last_error')).toBeNull()
      expect(sessionValue(variables, 'fn_out'), 'the Function output reaches fn_out').toBe(5)
    })

    await test.step('5. the console shows the secret as the mask and never the value', () => {
      expect(
        entries.filter((entry) => entry.message.startsWith("Set variable 'api_token' = ")).map((entry) => entry.message),
        formatEntries(entries),
      ).toEqual([`Set variable 'api_token' = '${MASK}' (scope: test)`])
      const logLine = entries.filter((entry) => entry.level === 'INFO' && entry.message.startsWith(LOG_MARKER))
      expect(logLine.map((entry) => entry.message)).toEqual([
        `vars greeting=hello world next_attempt=2 summary=Run 7 done api_token=${MASK} ` +
          `host_list=["web-1","web-2","db-backup-1"] limits={"cpu":2,"mem":"4Gi"} retries=3 ` +
          `port=${MASK} vault_keys=${MASK} last_error=null fn_out=5`,
      ])
      for (const raw of RAW_SECRETS) {
        expect(
          entries.filter((entry) => entry.message.includes(raw)).map((entry) => entry.message),
          `no console line holds ${raw}`,
        ).toEqual([])
      }
    })

    await test.step('13. after the run, Delete & Edit by keyboard: text edits in place, the list opens its sheet', async () => {
      const savedToken = (await storedSetter(page, testId)).config.values.variables.api_token
      sheet = await openBlockSheet(page, SETTER)

      const masked = maskedButton(sheet, 'api_token')
      await tabTo(page, secretBox(sheet, ROW.api_token), masked)
      await askWithEnter(page)
      await answerWithKeyboard(page, 'Delete & Edit')
      await expect(masked).toHaveCount(0)
      await expect(valueSheets(page), 'a text secret opens no sheet').toHaveCount(0)
      await expect(valueBox(sheet, ROW.api_token)).toHaveValue('')
      await expect(valueBox(sheet, ROW.api_token), 'focus is in the emptied value box').toBeFocused()

      const listMasked = maskedButton(sheet, 'vault_keys')
      await tabTo(page, secretBox(sheet, ROW.vault_keys), listMasked)
      await askWithEnter(page)
      await answerWithKeyboard(page, 'Delete & Edit')
      const listSheet = valueSheets(page)
      await expect(listSheet, 'the emptied list opens its sheet').toHaveCount(1)
      await expect(listSheet.getByTestId('value-editor-type-badge')).toHaveText('array')
      await expect.poll(() => holdsFocusInside(listSheet), { message: 'focus is inside the sheet' }).toBe(true)
      await page.keyboard.press('Escape')
      await expect(listSheet).toHaveCount(0)
      await expect(valueBox(sheet, ROW.vault_keys), "focus returns to the row's value box").toBeFocused()
      expect(await focusIsOnPageBody(page), 'focus is on the page body').toBe(false)

      await closeWithoutSave(page, sheet)
      const kept = (await storedSetter(page, testId)).config.values.variables
      expect(kept.api_token, 'the window closed without Save').toBe(savedToken)
      expect(String(kept.vault_keys)).toMatch(SEALED)
    })
  })

  test('a fresh Setter: messages at open, the {x} editor title, a blank {x} and a type change to Boolean', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    await page.request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    await page.goto('/workbench')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/workbench')
    await waitForCanvasLoad(page)
    await expandPalette(page)
    const before = await canvasBlockIds(page)
    const canvas = await page.getByTestId('workflow-canvas').boundingBox()
    expect(canvas, 'the canvas has a box').toBeTruthy()
    await dragPaletteItemToCanvas(
      page,
      { term: 'var setter', testId: 'palette-item-variable-setter' },
      { x: canvas!.width / 2, y: canvas!.height / 2 },
    )
    const added = (await canvasBlockIds(page)).filter((id) => !before.includes(id))
    expect(added, 'one Setter was dropped').toHaveLength(1)
    const sheet = await openBlockSheet(page, added[0])

    await test.step('6. the nameless row says Name is required at open; its {x} editor is Edit expression', async () => {
      await expect(nameBox(sheet, 0)).toHaveValue('')
      await expect(nameBox(sheet, 0)).toHaveAttribute('placeholder', 'Variable name')
      await expect(sheet.getByTestId('varset-name-error-0')).toHaveText('Name is required')
      await rowToggle(sheet, 0).click()
      await expect(switchWarning(page), 'a null value switches without a question').toHaveCount(0)
      await expect(rowToggle(sheet, 0)).toHaveAttribute('aria-pressed', 'true')
      await expandButton(sheet, 0).click()
      const editor = page.getByTestId('expression-editor-modal')
      await expect(editor).toBeVisible()
      await expect(editor.locator('h2').first()).toHaveText('Edit expression')
      await page.keyboard.press('Escape')
      await expect(editor).toHaveCount(0)
      await expect(sheet).toBeVisible()
    })

    await test.step('11. a blank {x} says Value is required and holds Save on its own', async () => {
      await expect(valueError(sheet, 0)).toHaveText('Value is required')
      await nameBox(sheet, 0).fill('fresh_target')
      await expect(sheet.getByTestId('varset-name-error-0')).toHaveCount(0)
      await expect(valueError(sheet, 0)).toHaveText('Value is required')
      await expect(windowSave(sheet)).toBeDisabled()
      await expect(sheet.getByTestId('save-blocked-note')).toHaveText(SAVE_HELD_NOTE)
      const editor = valueBox(sheet, 0).locator('.cm-content')
      await editor.click()
      await page.keyboard.insertText('1')
      await expect(editor).toHaveText('1')
      await leaveExpressionEditor(editor)
      await expect(valueError(sheet, 0)).toHaveCount(0)
      await expect(windowSave(sheet)).toBeEnabled()
    })

    await test.step('8. Boolean on a filled new secret row asks first, then clears and disables Secret', async () => {
      await sheet.getByTestId('varset-add-button').click()
      await expect(nameBox(sheet, 1)).toBeFocused()
      await nameBox(sheet, 1).fill('fresh_flag')
      await valueBox(sheet, 1).click()
      await page.keyboard.type('abc')
      await expect(valueBox(sheet, 1)).toHaveValue('abc')
      await secretBox(sheet, 1).click()
      await expect(secretBox(sheet, 1)).toHaveAttribute('aria-checked', 'true')

      await typeSelect(sheet, 1).click()
      await page.getByRole('option', { name: 'Boolean', exact: true }).click()
      const question = page.getByRole('alertdialog').filter({ hasText: 'Change variable type?' })
      await expect(question).toBeVisible()
      await expect(question).toContainText(
        'Changing type to boolean will clear 1 existing string value. This cannot be undone.',
      )
      await question.getByRole('button', { name: 'Change type', exact: true }).click()
      await expect(question).toHaveCount(0)
      await expect(typeSelect(sheet, 1)).toHaveText('Boolean')
      await expect(secretBox(sheet, 1)).toHaveAttribute('aria-checked', 'false')
      await expect(secretBox(sheet, 1)).toBeDisabled()
    })

    await closeWithoutSave(page, sheet)
  })

  test('a declared type change in the Variable Manager reaches the open row; Save and the run use it', async ({
    page,
  }) => {
    test.setTimeout(180_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(3))
    await expandVariableManager(page)
    const sheet = await openBlockSheet(page, SETTER)
    await expect(typeSelect(sheet, ROW.next_attempt)).toHaveText('Integer')

    let openRowFollowed = false
    await test.step('9. Float picked in the Variable Manager, with the window open and untouched', async () => {
      const win = await openEditWindow(page, 'next_attempt')
      await retypeInWindow(page, win, 'float')
      await saveWindow(page, win)
      openRowFollowed = await showsWithin(typeSelect(sheet, ROW.next_attempt), 'Float')
      await closeWithoutSave(page, sheet)
    })

    await test.step('9. the window opened after the change shows Float on the held row', async () => {
      const reopened = await openBlockSheet(page, SETTER)
      await expect(typeSelect(reopened, ROW.next_attempt)).toHaveText('Float')
      await expect(typeSelect(reopened, ROW.next_attempt)).toHaveAttribute('aria-disabled', 'true')
      await expect(rowToggle(reopened, ROW.next_attempt)).toHaveAttribute('aria-pressed', 'true')
      await closeWithoutSave(page, reopened)
    })

    await test.step('9. the Save stores the type on the variable and none on the Block', async () => {
      await saveTest(page)
      const stored = await storedTest(page, testId)
      expect(stored.variables.next_attempt?.type).toBe('float')
      const data = stored.workflow.nodes.find((node) => node.id === SETTER)!.data
      for (const key of OLD_KEYS) expect(data, `no ${key} on the Block`).not.toHaveProperty(key)
      expect(data.config.values.variables.next_attempt).toBe('attempt + 1')
    })

    await test.step('9. the run sets next_attempt as a float', async () => {
      const entries = await runPassed(page)
      expectConsoleLine(entries, 'DEBUG', "Set variable 'next_attempt' = 2 (scope: test)")
      const variables = await getSessionVariables(page, await getActiveSessionId(page))
      expect(variables.next_attempt?.type).toBe('float')
      expect(Number(sessionValue(variables, 'next_attempt'))).toBe(2)
    })

    expect(openRowFollowed, 'the open, untouched row shows the type the Variable Manager gave its variable').toBe(true)
  })

  test('two rows keep their own sheets open at once, and each sheet takes focus as it opens', async ({ page }) => {
    test.setTimeout(120_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(8))
    const sheet = await openBlockSheet(page, SETTER)

    // One sheet opens with the pointer, the other with the keyboard.
    await expandButton(sheet, ROW.greeting).click()
    await expect(rowSheet(page, 'greeting')).toHaveCount(1)
    const greetingFocused = await focusedWithin(sheetEditor(rowSheet(page, 'greeting'), 'greeting'))
    await openRowSheet(page, sheet, ROW.summary)
    await expect(rowSheet(page, 'summary')).toHaveCount(1)
    const summaryFocused = await focusedWithin(sheetEditor(rowSheet(page, 'summary'), 'summary'))

    await expect(valueSheets(page), 'both sheets are open').toHaveCount(2)
    await expect(rowSheet(page, 'greeting')).toBeVisible()
    await expect(sheetEditor(rowSheet(page, 'greeting'), 'greeting')).toHaveText('hello world')
    await expect(sheetEditor(rowSheet(page, 'summary'), 'summary')).toHaveText('Run {{ run_id }} done')
    const focusTarget = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null
      return active?.getAttribute('aria-label') ?? active?.tagName ?? 'none'
    })
    expect(
      { greeting: greetingFocused, summary: summaryFocused },
      `each sheet puts keyboard focus in its editor as it opens (focus is on "${focusTarget}")`,
    ).toEqual({ greeting: true, summary: true })
  })

  test('Delete & Edit on a stored text secret gives an empty focused box, and the typed value is stored sealed', async ({
    page,
  }) => {
    test.setTimeout(120_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(4))
    const imported = (await storedSetter(page, testId)).config.values.variables.api_token
    const sheet = await openBlockSheet(page, SETTER)

    await deleteAndEdit(page, sheet, 'api_token')
    await expect(maskedButton(sheet, 'api_token')).toHaveCount(0)
    await expect(valueSheets(page), 'no Edit value sheet opens').toHaveCount(0)
    const box = valueBox(sheet, ROW.api_token)
    await expect(box).toHaveValue('')
    await expect(box).toBeFocused()
    await page.keyboard.type(TYPED_TOKEN)
    await expect(box).toHaveValue(TYPED_TOKEN)

    await saveBlockSheet(sheet)
    await saveTest(page)
    const stored = (await storedSetter(page, testId)).config.values.variables.api_token
    expect(String(stored), 'the typed value is stored sealed').toMatch(SEALED)
    expect(stored, 'the old sealed value is gone').not.toBe(imported)
    expect((await plaintextRows(page, testId)).api_token).toBe(TYPED_TOKEN)
  })

  test('Delete & Edit on a stored integer secret starts on 0 with focus, and 8080 saves sealed', async ({ page }) => {
    test.setTimeout(120_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(5))
    const imported = (await storedSetter(page, testId)).config.values.variables.port
    expect(String(imported), 'the import sealed the number').toMatch(SEALED)
    const sheet = await openBlockSheet(page, SETTER)

    await deleteAndEdit(page, sheet, 'port')
    const box = valueBox(sheet, ROW.port)
    await expect(box).toHaveValue('0')
    await expect(box).toBeFocused()
    await expect(valueSheets(page)).toHaveCount(0)
    await expect(windowSave(sheet)).toBeEnabled()

    await box.fill('8080')
    await expect(box).toHaveValue('8080')
    await saveBlockSheet(sheet)
    await saveTest(page)
    const stored = (await storedSetter(page, testId)).config.values.variables.port
    expect(String(stored)).toMatch(SEALED)
    expect(stored).not.toBe(imported)
    // A secret row is stored as typed, not in the number wire form.
    expect(String((await plaintextRows(page, testId)).port)).toBe('8080')
  })

  test('deleting a row whose sheet holds typed text asks first; Close takes only that row and its sheet', async ({
    page,
  }) => {
    test.setTimeout(150_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(6))
    const sheet = await openBlockSheet(page, SETTER)
    const rowNames = sheet.locator('[data-testid^="varset-name-input-"]')
    await expect(rowNames).toHaveCount(9)

    await openRowSheet(page, sheet, ROW.greeting)
    await expect(rowSheet(page, 'greeting')).toHaveCount(1)
    await openRowSheet(page, sheet, ROW.summary)
    await expect(rowSheet(page, 'summary')).toHaveCount(1)
    await typeInSheet(page, sheetEditor(rowSheet(page, 'summary'), 'summary'), 'typed and never saved')

    const deleteSummary = async () => {
      await sheet.getByTestId(`varset-delete-${ROW.summary}`).focus()
      await page.keyboard.press('Enter')
    }

    await test.step('Keep Editing keeps the row and both sheets', async () => {
      await deleteSummary()
      const question = unsavedQuestion(page)
      await expect(question).toBeVisible()
      await expect(question.getByTestId('unsaved-keep-editing')).toHaveText('Keep Editing')
      await expect(question.getByTestId('unsaved-close')).toHaveText('Close')
      await expect(question.getByTestId('unsaved-save'), 'the row is going, so Save is not offered').toHaveCount(0)
      await question.getByTestId('unsaved-keep-editing').click()
      await expect(question).toHaveCount(0)
      await expect(nameBox(sheet, ROW.summary)).toHaveValue('summary')
      await expect(valueSheets(page)).toHaveCount(2)
    })

    await test.step('Close removes the row and its sheet; the other sheet stays on its own row', async () => {
      await deleteSummary()
      const question = unsavedQuestion(page)
      await expect(question).toBeVisible()
      await question.getByTestId('unsaved-close').click()
      await expect(question).toHaveCount(0)
      await expect(rowNames).toHaveCount(8)
      await expect(nameBox(sheet, ROW.summary), 'the rows after it move up').toHaveValue('api_token')
      await expect(rowSheet(page, 'summary')).toHaveCount(0)
      await expect(valueSheets(page)).toHaveCount(1)
      await expect(rowSheet(page, 'greeting')).toHaveCount(1)
    })

    await test.step("the first row's sheet Save writes the first row", async () => {
      const greetingSheet = rowSheet(page, 'greeting')
      await typeInSheet(page, sheetEditor(greetingSheet, 'greeting'), 'hello again')
      await greetingSheet.getByTestId('value-editor-save-button').click()
      await expect(valueBox(sheet, ROW.greeting)).toHaveValue('hello again')
      await greetingSheet.getByTestId('value-editor-cancel-button').click()
      await expect(valueSheets(page)).toHaveCount(0)
      await saveBlockSheet(sheet)
      await saveTest(page)
      const rows = (await storedSetter(page, testId)).config.values.variables
      expect(rows.greeting).toBe('hello again')
      expect(rows, 'the deleted row is gone').not.toHaveProperty('summary')
      expect(Object.keys(rows)).toEqual([
        'greeting',
        'next_attempt',
        'api_token',
        'host_list',
        'limits',
        'retries',
        'port',
        'vault_keys',
      ])
    })
  })

  test('each row {x} is reachable by its name and switches its own row', async ({ page }) => {
    test.setTimeout(120_000)
    testId = await importValidateAndNavigate(page, fixtureNamed(7))
    const sheet = await openBlockSheet(page, SETTER)

    await test.step('17. each {x} is the button named <row name> expression mode, with its pressed state', async () => {
      const rows: Array<[keyof typeof ROW, boolean]> = [
        ['greeting', false],
        ['next_attempt', true],
        ['summary', false],
        ['api_token', false],
        ['host_list', false],
        ['limits', false],
        ['retries', false],
      ]
      for (const [name, pressed] of rows) {
        const toggle = sheet.getByRole('button', { name: `${name} expression mode`, exact: true })
        await expect(toggle, `${name} has one {x} by that name`).toHaveCount(1)
        await expect(toggle).toHaveAttribute('data-testid', `varset-expression-toggle-${ROW[name]}`)
        await expect(toggle).toHaveAttribute('aria-pressed', String(pressed))
      }
    })

    await test.step('17. pressed by its name, the {x} of retries switches that row only', async () => {
      await sheet.getByRole('button', { name: 'retries expression mode', exact: true }).click()
      await expect(switchWarning(page)).toContainText(SWITCH_TO_EXPRESSION_TITLE)
      await answerSwitch(page, 'Clear')
      await expect(rowToggle(sheet, ROW.retries)).toHaveAttribute('aria-pressed', 'true')
      await expect(valueError(sheet, ROW.retries)).toHaveText('Value is required')
      await expect(rowToggle(sheet, ROW.limits)).toHaveAttribute('aria-pressed', 'false')
      await expect(windowSave(sheet)).toBeDisabled()
    })

    await closeWithoutSave(page, sheet)
  })
})
