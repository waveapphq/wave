/**
 * V-FIELDERR-01: Field-level save errors on the block config sheet
 * Design Decisions: FIELDERR-1, FIELDERR-2, FIELDERR-3, SQL-8, FIELD-1, FIELD-2, FIELD-7
 * REQ: REQ-3.4.1.6
 *
 * Runs in the no-data project list. Each test seeds its own Test holding one SQL block (Run
 * SQL, PostgreSQL) and afterAll deletes it. Colors are compared with the theme's own tokens,
 * so the assertions hold in both themes.
 *
 * Pass Criteria:
 * 1. As the sheet opens, every empty required row already carries its message - "Host is
 *    required", "Database is required", "Username is required", "SQL is required" - and the
 *    note under the disabled Save reads "Save is disabled: the settings have errors".
 * 2. A present wrong value shows its message the moment it is typed, while the field still has
 *    focus: Port 70000 reads "Port must be between 1 and 65535" and Timeout 0 reads "Timeout
 *    must be at least 1" (typed over Timeout's gray default).
 * 3. Each message sits under its own field in the destructive color, the field takes the
 *    destructive border and is marked invalid and described by the
 *    message; exactly six rows are flagged and the note stays the generic line.
 * 4. A message never moves the row: on Port and Timeout the info badge, label, type, field and
 *    expression toggle keep the position they had before, relative to the row's top; the label
 *    stays centered on the field; the row grows downward and the message hangs below the
 *    field, left-aligned with it.
 * 5. Username in expression mode reading a bare usr trades its required message for "Variable
 *    'usr' is not defined" in the design system's Warning Text color, under the field, with
 *    the field in the amber outline and not marked invalid; it is not an alert, the row's
 *    parts stay where they were, and the flagged rows drop to five.
 * 6. On an otherwise complete block (Username switched to {x} through the switch warning's Clear) the same
 *    warning leaves Save enabled with no note; Save
 *    takes the expression, and reopening the sheet shows Username still in expression mode
 *    with the warning at once.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { openConfig } from '../../functional/file-picker/picker'
import {
  POSTGRES_PORT,
  SQL_STACK_DATABASE,
  SQL_STACK_USER,
  SQL_TARGET_HOST,
} from '../../helpers/config'
import { askSwitch, answerSwitch } from '../../helpers/value-field'
import {
  type Box,
  type RowGeometry,
  elementColor,
  exprToggle,
  numberInput,
  paramRow,
  resolvedColor,
  rowAlerts,
  rowError,
  rowGeometry,
  rowWarning,
  saveButton,
  settingsNote,
} from '../../helpers/config-sheet'
import {
  SETTINGS_NOTE,
  SQL_NODE_ID,
  SQL_SHEET_TITLE,
  deleteSqlTests,
  openIncompleteSqlSheet,
  openValidSqlSheet,
} from './sql-sheet-seed'

const REQUIRED_ON_OPEN: ReadonlyArray<[string, string]> = [
  ['host', 'Host is required'],
  ['database', 'Database is required'],
  ['username', 'Username is required'],
  ['sql', 'SQL is required'],
]
const PORT_MESSAGE = 'Port must be between 1 and 65535'
const TIMEOUT_MESSAGE = 'Timeout must be at least 1'
const USR_WARNING = "Variable 'usr' is not defined"

/** The value control each measured row shows, inside its row: the one value field's box (FIELD-1) or the {x} editor. */
const FIELDS: Record<string, string> = {
  host: '[data-slot="input-group"] input',
  port: '[data-testid="param-input-port"]',
  sql: '[data-slot="input-group"] input',
  timeout: '[data-testid="param-input-timeout"]',
  username: '[data-testid="param-input-username"]',
}
// A number row is measured by its frame: the reset icon inside it (FIELD-3) narrows the inner box.
const GEOMETRY: Record<string, string> = {
  port: '[data-slot="input-group"]',
  timeout: '[data-slot="input-group"]',
}
const ERROR_ROWS = ['host', 'port', 'sql', 'timeout']
const BOUND_ROWS = ['port', 'timeout']

const created: string[] = []

const field = (sheet: Locator, name: string) => paramRow(sheet, name).locator(FIELDS[name])
// The field's border is drawn by its input group.
const fieldFrame = (sheet: Locator, name: string) => paramRow(sheet, name).locator('[data-slot="input-group"]')

/** Half a pixel covers subpixel layout; anything more is the part moving. */
function expectSameSpot(before: Box | null, after: Box | null, what: string): void {
  if (before === null) {
    expect(after, `${what} appears with the message`).toBeNull()
    return
  }
  expect(after, `${what} is still there`).not.toBeNull()
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after![key] - before[key]), `${what} ${key} moved: ${before[key]} -> ${after![key]}`).toBeLessThanOrEqual(0.5)
  }
}

function centerY(box: Box): number {
  return box.y + box.height / 2
}

/** FIELDERR-2: the info badge, label, type, field and toggle keep their places. */
function expectSameParts(name: string, before: RowGeometry, after: RowGeometry): void {
  for (const part of ['info', 'label', 'type', 'field', 'toggle'] as const) {
    expectSameSpot(before[part], after[part], `${name} ${part}`)
  }
}

/** FIELDERR-2: the parts keep their places, the row grows downward and the message hangs below the field. */
function expectGrewDownward(name: string, before: RowGeometry, after: RowGeometry): void {
  expect(before.message, `${name} had no message before`).toBeNull()
  expectSameParts(name, before, after)
  const fieldBox = after.field!
  const label = after.label!
  expect(Math.abs(centerY(label) - centerY(fieldBox)), `${name} label centered on the field`).toBeLessThanOrEqual(1.5)
  expect(after.row.height, `${name} row grows`).toBeGreaterThan(before.row.height)
  const message = after.message
  expect(message, `${name} message`).not.toBeNull()
  expect(message!.y, `${name} message below the field`).toBeGreaterThanOrEqual(fieldBox.y + fieldBox.height)
  expect(message!.y + message!.height, `${name} message inside the row`).toBeLessThanOrEqual(after.row.height)
  expect(Math.abs(message!.x - fieldBox.x), `${name} message left-aligned with the field`).toBeLessThanOrEqual(1)
}

async function measure(sheet: Locator, names: string[]): Promise<Record<string, RowGeometry>> {
  const out: Record<string, RowGeometry> = {}
  for (const name of names) out[name] = await rowGeometry(sheet, name, GEOMETRY[name] ?? FIELDS[name])
  return out
}

/** Put the Username row in expression mode and type a bare name no variable carries. */
async function typeBareUsr(page: Page, sheet: Locator): Promise<void> {
  const editor = field(sheet, 'username').locator('.cm-content')
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('usr')
  await expect(editor).toHaveText('usr')
}

// ---------------------------------------------------------------------------

test.describe('V-FIELDERR-01: Field-level save errors on the block config sheet', () => {
  test.afterAll(async ({ request }) => {
    await deleteSqlTests(request, created)
  })

  test('V-FIELDERR-01 messages: under their fields, at once, without moving the row', async ({
    page,
  }) => {
    const { testId, sheet } = await openIncompleteSqlSheet(page, 'V-FIELDERR-01 messages', {}, [
      'host',
      'database',
      'username',
      'sql',
    ])
    created.push(testId)

    // FIELDERR-3: every empty required row shows its message as the sheet opens.
    for (const [name, message] of REQUIRED_ON_OPEN) {
      await expect(rowError(sheet, name), `${name} on open`).toHaveText(message)
    }
    await expect(rowAlerts(sheet)).toHaveCount(REQUIRED_ON_OPEN.length)
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
    await expect(saveButton(sheet)).toBeDisabled()
    const before = await measure(sheet, BOUND_ROWS)

    // FIELDERR-3: a wrong present value is messaged the moment it is typed, while its field still has focus.
    await numberInput(sheet, 'port').fill('70000')
    await expect(numberInput(sheet, 'port')).toBeFocused()
    await expect(rowError(sheet, 'port')).toHaveText(PORT_MESSAGE)
    // FIELD-2: Timeout shows its gray default, and the first key typed replaces it.
    await numberInput(sheet, 'timeout').click()
    await page.keyboard.type('0')
    await expect(numberInput(sheet, 'timeout')).toHaveValue('0')
    await expect(numberInput(sheet, 'timeout')).toBeFocused()
    await expect(rowError(sheet, 'timeout')).toHaveText(TIMEOUT_MESSAGE)

    await expect(rowAlerts(sheet)).toHaveCount(REQUIRED_ON_OPEN.length + BOUND_ROWS.length)
    await expect(settingsNote(sheet), 'FIELDERR-1: the note stays generic').toHaveText(SETTINGS_NOTE)
    await expect(saveButton(sheet)).toBeDisabled()

    // FIELDERR-1: the destructive border on the field, the message in the same color, tied to it.
    const destructive = await resolvedColor(page, 'var(--destructive)')
    for (const name of ERROR_ROWS) {
      const control = field(sheet, name)
      await expect(control, `${name} invalid`).toHaveAttribute('aria-invalid', 'true')
      const messageId = await rowError(sheet, name).getAttribute('id')
      expect(messageId, `${name} message id`).toBeTruthy()
      await expect(control, `${name} described by its message`).toHaveAttribute('aria-describedby', messageId!)
      // The border may ease its color in, so the settled color is polled.
      await expect
        .poll(() => elementColor(fieldFrame(sheet, name), 'borderTopColor'), { message: `${name} border` })
        .toBe(destructive)
      expect(await elementColor(rowError(sheet, name), 'color'), `${name} message color`).toBe(destructive)
    }

    // FIELDERR-2: nothing in the row moves; the message hangs below the field.
    const after = await measure(sheet, BOUND_ROWS)
    for (const name of BOUND_ROWS) expectGrewDownward(name, before[name], after[name])

    // FIELDERR-3: an unknown variable in an expression is amber and never counted.
    await exprToggle(sheet, 'username').click()
    await expect(field(sheet, 'username')).toBeVisible()
    await expect(rowError(sheet, 'username'), 'an empty expression is still required').toHaveText(
      'Username is required',
    )
    const usernameBefore = await rowGeometry(sheet, 'username', FIELDS.username)
    await typeBareUsr(page, sheet)
    await expect(rowWarning(sheet, 'username')).toHaveText(USR_WARNING)
    await expect(rowError(sheet, 'username')).toHaveCount(0)
    expect(await elementColor(rowWarning(sheet, 'username'), 'color'), 'Warning Text color').toBe(
      await resolvedColor(page, 'var(--color-warning-text)'),
    )
    await expect(rowWarning(sheet, 'username')).not.toHaveAttribute('role', 'alert')
    await expect(field(sheet, 'username')).not.toHaveAttribute('aria-invalid', 'true')
    await expect(field(sheet, 'username'), 'the expression field keeps its amber outline').toHaveClass(
      /\bborder-amber-500\b/,
    )
    expectSameParts('username', usernameBefore, await rowGeometry(sheet, 'username', FIELDS.username))
    await expect(rowAlerts(sheet), 'the warning is not a Save-blocking error').toHaveCount(
      REQUIRED_ON_OPEN.length + BOUND_ROWS.length - 1,
    )
    await expect(settingsNote(sheet)).toHaveText(SETTINGS_NOTE)
  })

  test('V-FIELDERR-01 warning only: an unknown variable leaves Save enabled and is saved', async ({ page }) => {
    const { testId, sheet } = await openValidSqlSheet(page, 'V-FIELDERR-01 warning', {
      host: SQL_TARGET_HOST,
      port: Number(POSTGRES_PORT),
      database: SQL_STACK_DATABASE,
      username: SQL_STACK_USER,
      sql: 'SELECT 1',
    })
    created.push(testId)
    await expect(settingsNote(sheet)).toHaveCount(0)

    // FIELD-7: switching a field that holds a value asks first; Clear leaves the {x} box empty.
    await askSwitch(page, sheet, 'username')
    await answerSwitch(page, 'Clear')
    await typeBareUsr(page, sheet)
    await expect(rowWarning(sheet, 'username')).toHaveText(USR_WARNING)
    await expect(rowAlerts(sheet)).toHaveCount(0)
    await expect(settingsNote(sheet), 'FIELDERR-3: a warning is not counted in the note').toHaveCount(0)
    await expect(saveButton(sheet)).toBeEnabled()

    await saveButton(sheet).click()
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    // The saved expression comes back as written, and its warning shows at once.
    const reopened = await openConfig(page, SQL_NODE_ID)
    await expect(reopened.getByRole('heading', { name: SQL_SHEET_TITLE })).toBeVisible()
    await expect(exprToggle(reopened, 'username')).toHaveAttribute('aria-pressed', 'true')
    await expect(field(reopened, 'username').locator('.cm-content')).toHaveText('usr')
    await expect(rowWarning(reopened, 'username')).toHaveText(USR_WARNING)
    await expect(rowAlerts(reopened)).toHaveCount(0)
    await expect(settingsNote(reopened)).toHaveCount(0)
  })
})
