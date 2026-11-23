/**
 * V-CTRL-SETTER-01: the Variable Setter rows
 * Design Decisions: FIELD-1, FIELD-5, FIELD-6, FIELD-16, VARSET-5, VARSET-6, VARSET-7, VARSET-8, VMGR-83
 * REQ: REQ-3.4.1.14, REQ-3.1.3.21
 * Phase: no-data
 *
 * Seed (API, POST /tests): one `zz-ctrl-fields-setter-` Test per theme holding the Variable Setter `Set run values`
 * with the rows `greeting` = `hello world`, `next_attempt` {x} `attempt + 1`, `summary` Template
 * `Run {{ run_id }} done`, `api_token` secret (sealed at save), `host_list` = `["web-1", "web-2", {x} backup_host]`
 * and `limits` = `{"cpu": 2, "mem": "4Gi"}`, every target a declared Test variable; validated with zero errors and
 * deleted afterwards. The row `last_error` is added in the open window and the error state is built there; neither
 * is saved.
 *
 * Pass Criteria (in both themes):
 * 1. The window opens 880 px wide.
 * 2. The column headers Name, Type, Secret and Value sit over their columns: Name 189, Type 100 x 32, Secret 32
 *    (label centered), the value box (357 px), expand 32, {x} 32, delete 32, 8 px apart; Value has 4 px left padding.
 * 3. Every row is centered on its 36 px boxes: the vertical centers of its parts are within 1 px.
 * 4. The null button sits inside the value box at its right end: unpressed on `greeting`, `host_list`, `limits`;
 *    pressed with the primary tint on `last_error`; none on `next_attempt`, `summary`, `api_token`.
 * 5. `summary` shows the Template face: `{{ run_id }}` in the expression color, the rest in the foreground color,
 *    no shadow.
 * 6. `host_list` draws `["web-1", "web-2", {{ backup_host }}]` on one line: its box gives the text at least the
 *    mock's 297 px, the third entry is in the expression color without quotes, the rest in the list color, and a
 *    line wider than the box (the font decides) ends with an ellipsis at the box edge, clear of the null button.
 * 7. `api_token` shows the masked face: lock, pencil, eight dots; its expand column is empty; {x} is there; the
 *    button is named `api_token: Edit protected value`.
 * 8. The Type select of an existing variable is held at 50 percent; on `last_error` it is enabled.
 * 9. Clearing `next_attempt`'s {x} shows `Value is required` 4 px under the value box, which takes the destructive
 *    border; the row grows 20 px; Save is disabled with `Save is disabled: the settings have errors`.
 * 10. A screenshot of the window in each theme is attached, filled and with the error.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { elementColor, resolvedColor, settingsNote } from '../../helpers/config-sheet'
import { replaceCode } from '../../helpers/fn-block'
import { openTest } from '../../helpers/fn-seed'
import { discardBlockSheet } from '../../helpers/number-entry'
import { toggleTheme } from '../../helpers/theme'
import {
  cellBox,
  cellError,
  cellInput,
  cellOverlay,
  cellStateMarker,
  expandButton,
  expressionBox,
  nullButton,
} from '../../helpers/value-field'
import { configSheet } from '../../helpers/workbench'
import {
  CODE_EXPRESSION_COLOR,
  HOST_LINE,
  NEW_ROW,
  PRESSED_FILL,
  SETTER_ID,
  SETTER_LABEL,
  SETTER_ROWS,
  THEMES,
  WIDE_WINDOW,
  attachWindow,
  bottom,
  deleteControlTest,
  expectMessageLook,
  fillOf,
  middle,
  near,
  openControlWindow,
  rectOf,
  right,
  seedControlTest,
  setterIndex,
  setterStem,
  styleOf,
  type Rect,
} from './control-fields-seed'

const GAP = 8
const COLUMN = 32
const VALUE_WIDTH = 357
// The text room a value gets beside its null button; the line's own width follows the font.
const MOCK_TEXT_ROOM = 297
const MESSAGE_GAP = 4
const GROWTH = 20
const SAVE_NOTE = 'Save is disabled: the settings have errors'
const ROWS = [...SETTER_ROWS, NEW_ROW] as const
const TYPES: Record<(typeof ROWS)[number], string> = {
  greeting: 'String',
  next_attempt: 'Integer',
  summary: 'String',
  api_token: 'String',
  host_list: 'Array',
  limits: 'Map',
  last_error: 'String',
}
const NULL_ROWS = { greeting: false, host_list: false, limits: false, last_error: true } as const
const NO_NULL_ROWS = ['next_attempt', 'summary', 'api_token'] as const

const control = (sheet: Locator, id: string, name: string): Locator =>
  sheet.getByTestId(`varset-${id}-${setterIndex(name)}`)
const secretColumn = (sheet: Locator, name: string): Locator => control(sheet, 'secret-checkbox', name).locator('xpath=..')

interface SetterRow {
  name: Rect
  type: Rect
  secret: Rect
  checkbox: Rect
  value: Rect
  expand: Rect | null
  toggle: Rect
  remove: Rect
}

async function setterRow(sheet: Locator, name: string): Promise<SetterRow> {
  const expand = expandButton(sheet, setterStem(name))
  return {
    name: await rectOf(control(sheet, 'name-input', name), `${name} name`),
    type: await rectOf(control(sheet, 'type-select', name), `${name} type`),
    secret: await rectOf(secretColumn(sheet, name), `${name} secret column`),
    checkbox: await rectOf(control(sheet, 'secret-checkbox', name), `${name} secret box`),
    value: await rectOf(cellBox(sheet, setterStem(name)), `${name} value box`),
    expand: (await expand.count()) === 0 ? null : await rectOf(expand, `${name} expand`),
    toggle: await rectOf(control(sheet, 'expression-toggle', name), `${name} {x}`),
    remove: await rectOf(control(sheet, 'delete', name), `${name} delete`),
  }
}

/** Add the row `last_error`: a new target, so its value starts null and its type is free. */
async function addNewRow(sheet: Locator): Promise<void> {
  await sheet.getByTestId('varset-add-button').click()
  const name = control(sheet, 'name-input', NEW_ROW)
  await expect(name).toBeFocused()
  await name.fill(NEW_ROW)
  await sheet.getByTestId('element-description-input').focus()
  await expect(cellStateMarker(sheet, setterStem(NEW_ROW))).toHaveText('null')
}

/** Criteria 2 and 3: the header over the columns, and every row on one line. */
async function expectColumns(sheet: Locator): Promise<void> {
  const header = sheet.getByText('Secret', { exact: true }).locator('xpath=..')
  const heads = {
    name: await rectOf(header.getByText('Name', { exact: true }), 'Name header'),
    type: await rectOf(header.getByText('Type', { exact: true }), 'Type header'),
    secret: await rectOf(header.getByText('Secret', { exact: true }), 'Secret header'),
    value: await rectOf(header.getByText('Value', { exact: true }), 'Value header'),
  }
  expect.soft(await styleOf(header.getByText('Value', { exact: true }), 'padding-left'), 'Value header padding').toBe('4px')
  const first = await setterRow(sheet, 'greeting')
  near(heads.name.x, first.name.x, 'Name over the name box')
  near(heads.type.x, first.type.x, 'Type over the type select')
  near(heads.secret.x + heads.secret.width / 2, first.checkbox.x + first.checkbox.width / 2, 'Secret centered over its box')
  near(heads.value.x, first.value.x, 'Value over the value box')
  await expect.soft(sheet.getByText('Variables', { exact: true })).toBeVisible()
  const add = sheet.getByTestId('varset-add-button')
  await expect.soft(add).toHaveText('Add')
  near((await rectOf(add, 'Add')).height, COLUMN, 'Add height')

  for (const name of ROWS) {
    const row = await setterRow(sheet, name)
    near(row.name.width, 189, `${name}: name width`)
    near(row.name.height, 36, `${name}: name height`)
    near(row.type.width, 100, `${name}: type width`)
    near(row.type.height, COLUMN, `${name}: type height`)
    near(row.secret.width, COLUMN, `${name}: secret column width`)
    near(row.checkbox.width, 16, `${name}: secret box size`)
    near(row.checkbox.x + row.checkbox.width / 2, row.secret.x + row.secret.width / 2, `${name}: secret box centered`)
    near(row.value.width, VALUE_WIDTH, `${name}: value box width`)
    near(row.value.height, 36, `${name}: value box height`)
    near(row.toggle.width, COLUMN, `${name}: {x} width`)
    near(row.remove.width, COLUMN, `${name}: delete width`)
    near(row.type.x - right(row.name), GAP, `${name}: name to type`)
    near(row.secret.x - right(row.type), GAP, `${name}: type to secret`)
    near(row.value.x - right(row.secret), GAP, `${name}: secret to value`)
    near(row.toggle.x - right(row.value), GAP + COLUMN + GAP, `${name}: value to {x}, the expand column between`)
    near(row.remove.x - right(row.toggle), GAP, `${name}: {x} to delete`)
    if (row.expand) {
      near(row.expand.width, COLUMN, `${name}: expand width`)
      near(row.expand.x - right(row.value), GAP, `${name}: value to expand`)
    }
    const center = middle(row.name)
    for (const [part, rect] of Object.entries(row)) {
      if (rect) near(middle(rect as Rect), center, `${name}: ${part} center`)
    }
    near(row.value.x, first.value.x, `${name}: the value column`)
    near(row.toggle.x, first.toggle.x, `${name}: the {x} column`)
    near(row.remove.x, first.remove.x, `${name}: the delete column`)
  }
}

async function expectInsideRightEnd(sheet: Locator, name: string, button: Locator): Promise<void> {
  const box = await rectOf(cellBox(sheet, setterStem(name)), `${name} value box`)
  const inner = await rectOf(button, `${name} null button`)
  expect.soft(inner.x, `${name}: the null button is inside the box`).toBeGreaterThan(box.x)
  const gap = right(box) - right(inner)
  expect.soft(gap, `${name}: the null button sits at the box's right end`).toBeGreaterThanOrEqual(0)
  expect.soft(gap, `${name}: the null button sits at the box's right end`).toBeLessThanOrEqual(12)
  near(middle(inner), middle(box), `${name}: the null button is centered in the box`, 2)
}

/** Criterion 4: the null button. */
async function expectNullButtons(page: Page, sheet: Locator): Promise<void> {
  const fill = await fillOf(page, PRESSED_FILL)
  const primary = await resolvedColor(page, 'var(--color-primary)')
  for (const [name, pressed] of Object.entries(NULL_ROWS)) {
    const button = nullButton(sheet, setterStem(name))
    await expect.soft(button, `${name}: the null button`).toHaveText('∅')
    await expect.soft(button).toHaveAttribute('aria-pressed', String(pressed))
    await expectInsideRightEnd(sheet, name, button)
    if (pressed) {
      expect.soft(await styleOf(button, 'background-color'), `${name}: the pressed null is tinted`).toBe(fill)
      expect.soft(await elementColor(button, 'color'), `${name}: the pressed null is primary`).toBe(primary)
    } else {
      expect.soft(await styleOf(button, 'background-color'), `${name}: an unpressed null has no tint`).toBe('rgba(0, 0, 0, 0)')
    }
  }
  for (const name of NO_NULL_ROWS) {
    await expect.soft(nullButton(sheet, setterStem(name)), `${name}: no null button`).toHaveCount(0)
  }
  const marker = cellStateMarker(sheet, setterStem(NEW_ROW))
  await expect.soft(marker).toHaveText('null')
  expect.soft(await styleOf(marker, 'font-style'), 'null is italic').toBe('italic')
  expect.soft(await elementColor(marker, 'color'), 'null is Text Muted').toBe(await resolvedColor(page, 'var(--color-text-muted)'))
}

/** Criteria 5 and 6, and the plain faces: each value in its own look. */
async function expectFaces(page: Page, sheet: Locator): Promise<void> {
  const expressionColor = await resolvedColor(page, 'var(--color-cyan-400)')
  const listColor = await resolvedColor(page, 'var(--color-amber-300)')

  const greeting = cellInput(sheet, setterStem('greeting'))
  await expect(greeting).toHaveValue('hello world')
  expect.soft(await elementColor(greeting, 'color'), 'greeting: the string color').toBe(
    await resolvedColor(page, 'var(--color-sky-300)'),
  )
  const limits = cellInput(sheet, setterStem('limits'))
  await expect(limits).toHaveValue('{"cpu": 2, "mem": "4Gi"}')
  expect.soft(await elementColor(limits, 'color'), 'limits: the map color').toBe(
    await resolvedColor(page, 'var(--color-emerald-400)'),
  )
  for (const name of ['greeting', 'host_list', 'limits', NEW_ROW]) {
    expect.soft(await styleOf(cellBox(sheet, setterStem(name)), 'box-shadow'), `${name}: a literal box has a shadow`).not.toBe('none')
  }

  const nextAttempt = cellInput(sheet, setterStem('next_attempt'))
  await expect(nextAttempt.locator('.cm-content')).toHaveText('attempt + 1')
  expect.soft(await elementColor(nextAttempt.locator('.cm-expression').first(), 'color'), 'next_attempt: the expression color').toBe(
    CODE_EXPRESSION_COLOR,
  )
  const nextToggle = control(sheet, 'expression-toggle', 'next_attempt')
  await expect(nextToggle).toHaveAttribute('aria-pressed', 'true')
  expect.soft(await styleOf(nextToggle, 'background-color'), 'pressed {x} fill').toBe(await fillOf(page, PRESSED_FILL))

  const summary = cellInput(sheet, setterStem('summary'))
  await expect(summary.locator('.cm-content')).toHaveText('Run {{ run_id }} done')
  const region = summary.locator('.cm-expression')
  await expect(region).toHaveText(['{{ run_id }}'])
  expect.soft(await elementColor(region, 'color'), 'summary: {{ run_id }} in the expression color').toBe(CODE_EXPRESSION_COLOR)
  expect.soft(await elementColor(summary.locator('.cm-line'), 'color'), 'summary: the text in the foreground color').toBe(
    await resolvedColor(page, 'var(--foreground)'),
  )
  await expect.soft(control(sheet, 'expression-toggle', 'summary'), 'a Template is no {x}').toHaveAttribute('aria-pressed', 'false')
  for (const name of ['next_attempt', 'summary']) {
    expect.soft(await styleOf(cellInput(sheet, setterStem(name)), 'box-shadow'), `${name}: no shadow`).toBe('none')
  }

  const hostBox = cellInput(sheet, setterStem('host_list'))
  await expect(hostBox, 'the box holds the line for copy').toHaveValue(HOST_LINE)
  const line = cellOverlay(sheet, setterStem('host_list'))
  await expect(line).toHaveText(HOST_LINE)
  const parts = line.locator(':scope > span')
  await expect(parts).toHaveText(['["web-1", "web-2", ', '{{ backup_host }}', ']'])
  expect.soft(await elementColor(parts.nth(0), 'color'), 'host_list: the list color').toBe(listColor)
  expect.soft(await elementColor(parts.nth(1), 'color'), 'host_list: the {x} entry color').toBe(expressionColor)
  expect.soft(await elementColor(parts.nth(2), 'color'), 'host_list: the list color').toBe(listColor)
  // The line is as wide as the font draws it; one wider than its room ends with the field's ellipsis.
  const shape = await line.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      room: el.clientWidth,
      cut: el.scrollWidth > el.clientWidth,
      look: {
        whiteSpace: style.whiteSpace,
        textOverflow: style.textOverflow,
        overflow: style.overflowX,
        lines: Math.round(el.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)),
      },
    }
  })
  expect.soft(shape.room, `host_list: at least the mock's text room ${JSON.stringify(shape)}`).toBeGreaterThanOrEqual(
    MOCK_TEXT_ROOM,
  )
  expect.soft(shape.look, 'host_list: one line that ends with an ellipsis').toEqual({
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    overflow: 'hidden',
    lines: 1,
  })
  const lineBox = await rectOf(line, 'host_list line')
  const textBox = await rectOf(hostBox, 'host_list text box')
  const nullBox = await rectOf(nullButton(sheet, setterStem('host_list')), 'host_list null button')
  expect.soft(right(lineBox), 'host_list: the line stays clear of the null button').toBeLessThanOrEqual(nullBox.x)
  if (shape.cut) near(right(lineBox), right(textBox) - 12, 'host_list: the ellipsis sits at the box edge')
}

/** Criterion 7: the masked face of a stored secret. */
async function expectMasked(sheet: Locator): Promise<void> {
  await expect(control(sheet, 'secret-checkbox', 'api_token')).toHaveAttribute('data-state', 'checked')
  const box = cellBox(sheet, setterStem('api_token'))
  const button = box.getByRole('button', { name: 'api_token: Edit protected value', exact: true })
  await expect(button).toBeVisible()
  const lock = await rectOf(box.locator('svg.lucide-lock'), 'lock')
  const pencil = await rectOf(button.locator('svg.lucide-pencil'), 'pencil')
  const dots = button.getByText('••••••••', { exact: true })
  await expect(dots).toBeVisible()
  const dotsBox = await rectOf(dots, 'dots')
  expect.soft(lock.x, 'the lock leads').toBeLessThan(pencil.x)
  expect.soft(pencil.x, 'the pencil before the dots').toBeLessThan(dotsBox.x)
  near(lock.width, 16, 'lock size')
  near(pencil.width, 14, 'pencil size')
  await expect.soft(expandButton(sheet, setterStem('api_token')), 'a masked secret has no expand').toHaveCount(0)
  await expect.soft(control(sheet, 'expression-toggle', 'api_token')).toBeVisible()
}

/** Criterion 8: the type of an existing variable is held; a new target's is free. */
async function expectTypes(sheet: Locator): Promise<void> {
  for (const name of ROWS) {
    const select = control(sheet, 'type-select', name)
    await expect.soft(select, `${name}: type`).toHaveText(TYPES[name])
    if (name === NEW_ROW) {
      await expect.soft(select, `${name}: a new target picks its type`).toBeEnabled()
      expect.soft(await styleOf(select, 'opacity'), `${name}: full opacity`).toBe('1')
    } else {
      await expect.soft(select, `${name}: the declared type is held`).toBeDisabled()
      expect.soft(await styleOf(select, 'opacity'), `${name}: held at 50 percent`).toBe('0.5')
    }
  }
}

/** Criterion 9: a blank {x} built in the window, never saved. */
async function expectBlankExpression(page: Page, sheet: Locator): Promise<void> {
  const destructive = await resolvedColor(page, 'var(--destructive)')
  const stem = setterStem('next_attempt')
  const below = control(sheet, 'name-input', 'summary')
  const belowBefore = await rectOf(below, 'summary row before')
  await replaceCode(page, expressionBox(sheet, stem), '')
  await sheet.getByTestId('element-description-input').focus()

  const message = cellError(sheet, stem)
  await expect(message).toHaveText('Value is required')
  await expectMessageLook(message, 'Value is required')
  expect.soft(await elementColor(message, 'color'), 'Value is required is destructive').toBe(destructive)
  const box = await rectOf(cellBox(sheet, stem), 'blank {x} box')
  const text = await rectOf(message, 'Value is required')
  near(text.y, bottom(box) + MESSAGE_GAP, 'Value is required sits 4 px under the box')
  near(text.x, box.x, 'Value is required starts at the box')
  expect.soft(await elementColor(cellBox(sheet, stem), 'borderTopColor'), 'the blank {x} box is red').toBe(destructive)
  await expect.soft(control(sheet, 'expression-toggle', 'next_attempt')).toHaveAttribute('aria-pressed', 'true')
  await expect.soft(expandButton(sheet, stem), 'the blank {x} keeps its expand').toBeVisible()
  near((await rectOf(below, 'summary row after')).y - belowBefore.y, GROWTH, 'the row grows 20 px')
  expect.soft(bottom(text), 'the message stays above the next row').toBeLessThanOrEqual((await rectOf(below, 'summary row')).y)

  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(settingsNote(sheet)).toHaveText(SAVE_NOTE)
}

test.describe('V-CTRL-SETTER-01: the Variable Setter rows', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await deleteControlTest(request, testId)
    testId = ''
  })

  for (const theme of THEMES) {
    test(`the rows of Set run values in the ${theme} theme`, async ({ page, request }, testInfo) => {
      testId = await seedControlTest(request, 'setter', theme)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const sheet = await openControlWindow(page, SETTER_ID, SETTER_LABEL)
      await addNewRow(sheet)
      await attachWindow(testInfo, `setter-rows-${theme}.png`, sheet)

      await test.step('1. the window opens 880 px wide', async () => {
        near((await rectOf(configSheet(page), 'window')).width, WIDE_WINDOW, 'window width')
      })
      await test.step('2, 3. header and columns, rows centered', () => expectColumns(sheet))
      await test.step('4. the null button', () => expectNullButtons(page, sheet))
      await test.step('5, 6. Template, {x} and list faces', () => expectFaces(page, sheet))
      await test.step('7. the masked secret', () => expectMasked(sheet))
      await test.step('8. held and free types', () => expectTypes(sheet))
      await test.step('9. a blank {x}', () => expectBlankExpression(page, sheet))
      await attachWindow(testInfo, `setter-rows-errors-${theme}.png`, sheet)

      await discardBlockSheet(page, sheet)
    })
  }
})
