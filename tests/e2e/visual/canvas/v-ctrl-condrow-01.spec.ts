/**
 * V-CTRL-CONDROW-01: the condition row in the If/Else window
 * Design Decisions: FIELD-1, FIELD-14, FIELD-15, FIELD-16, FIELDERR-1, FIELDERR-2
 * REQ: REQ-3.1.1.5, REQ-3.5.1.1, REQ-3.5.1.5, REQ-3.5.1.6
 * Phase: no-data
 *
 * Seed (API, POST /tests): one `zz-ctrl-fields-condrow-` Test per theme holding the If/Else `Route by health`:
 * IF `Healthy` (`status` equals `ready` OR `status` equals {x} `expected_status`), ELSE IF `Slow` (`latency_ms`
 * greater than `500` AND a group (`retries` less than `3` OR `region` starts with `eu`) AND the expression
 * `len(errors) == 0`), ELSE `Fallback`; validated with zero errors and deleted afterwards. The error state is built
 * in the open window and never saved.
 *
 * Pass Criteria (in both themes):
 * 1. The window opens 880 px wide.
 * 2. Every condition row sits on one line: the vertical centers of its parts are within 1 px.
 * 3. The variable box is 160 x 36; the operator list is 140 x 36 with radius 8 and the shared choice look (1 px
 *    border, shadow, clear fill, 14 px text, chevron at 50 percent); the value box takes the rest of the row.
 * 4. The expand and {x} columns line up within one nesting level; the group's columns sit 13 px left of the top
 *    level's.
 * 5. Text rows show the expand; number rows leave its 32 px column empty.
 * 6. Text values take the string color, numbers the integer color, {x} values the expression color; the pressed
 *    {x} has the primary fill at 10 percent and the primary icon color.
 * 7. The expression row's expand sits in the top-level expand column, its {x} column stays empty, its actions sit
 *    in their column.
 * 8. Branch cards, pills, the group and the buttons are as before: count, order and texts.
 * 9. Errors built in the window: Add Assertion in IF shows `Choose a variable.` 4 px under the variable box (12 px,
 *    destructive) and leaves that row's value box border as is; clearing the {x} value gives it the destructive
 *    border and `Value is required` 4 px under it; each of the two rows grows 20 px and the pill under a message
 *    starts at or below it; the IF card shows its warning mark; Save is disabled with
 *    `Save is disabled: the settings have errors`.
 * 10. A screenshot of the window in each theme is attached, filled and with the errors.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { elementColor, resolvedColor, settingsNote } from '../../helpers/config-sheet'
import { replaceCode } from '../../helpers/fn-block'
import { openTest } from '../../helpers/fn-seed'
import { discardBlockSheet } from '../../helpers/number-entry'
import { toggleTheme } from '../../helpers/theme'
import { cellBox, cellError, cellInput, expandButton, expressionBox } from '../../helpers/value-field'
import { configSheet } from '../../helpers/workbench'
import {
  CODE_EXPRESSION_COLOR,
  CONDITION_PATHS as P,
  ELSE_BRANCH,
  IF_BRANCH,
  IF_ELSE_ID,
  IF_ELSE_LABEL,
  PRESSED_FILL,
  RETRIES_GROUP,
  SLOW_BRANCH,
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
  styleOf,
  type Rect,
} from './control-fields-seed'

const GAP = 8
const COLUMN = 32
// A nested group's border and padding take 13 px off each side of its rows.
const GROUP_INSET = 13
const MESSAGE_GAP = 4
const GROWTH = 20
const SAVE_NOTE = 'Save is disabled: the settings have errors'

const body = (sheet: Locator, branch: string): Locator => sheet.getByTestId(`branch-body-${branch}`)
const valueStem = (path: string): string => `assert-value-${path}`

interface LiteralRow {
  variable: Rect
  pill: Rect
  operator: Rect
  value: Rect
  expand: Rect | null
  toggle: Rect
  remove: Rect
  up: Rect
  down: Rect
}

async function literalRow(scope: Locator, path: string): Promise<LiteralRow> {
  const expand = expandButton(scope, valueStem(path))
  return {
    variable: await rectOf(scope.getByTestId(`assert-variable-${path}`), `${path} variable`),
    pill: await rectOf(scope.getByTestId(`assert-type-badge-${path}`), `${path} type pill`),
    operator: await rectOf(scope.getByTestId(`assert-operator-${path}`), `${path} operator`),
    value: await rectOf(cellBox(scope, valueStem(path)), `${path} value box`),
    expand: (await expand.count()) === 0 ? null : await rectOf(expand, `${path} expand`),
    toggle: await rectOf(scope.getByTestId(`assert-expr-toggle-${path}`), `${path} {x}`),
    remove: await rectOf(scope.getByTestId(`assert-delete-${path}`), `${path} delete`),
    up: await rectOf(scope.getByTestId(`assert-move-up-${path}`), `${path} up`),
    down: await rectOf(scope.getByTestId(`assert-move-down-${path}`), `${path} down`),
  }
}

/** Criteria 2, 3 and 5 on one literal row. */
function expectLiteralRow(row: LiteralRow, what: string, kind: 'text' | 'number'): void {
  near(row.variable.width, 160, `${what}: variable box width`)
  near(row.variable.height, 36, `${what}: variable box height`)
  near(row.operator.width, 140, `${what}: operator width`)
  near(row.operator.height, 36, `${what}: operator height`)
  near(row.value.height, 36, `${what}: value box height`)
  near(row.pill.x - right(row.variable), GAP, `${what}: variable to pill`)
  near(row.operator.x - right(row.pill), GAP, `${what}: pill to operator`)
  near(row.value.x - right(row.operator), GAP, `${what}: operator to value`)
  // The value takes what the expand and {x} columns leave.
  near(row.toggle.x - right(row.value), GAP + COLUMN + GAP, `${what}: value to {x}`)
  near(row.toggle.width, COLUMN, `${what}: {x} width`)
  near(row.remove.x - right(row.toggle), GAP, `${what}: {x} to delete`)
  if (kind === 'text') {
    expect.soft(row.expand, `${what}: a text value shows its expand`).not.toBeNull()
    if (row.expand) {
      near(row.expand.x - right(row.value), GAP, `${what}: value to expand`)
      near(row.expand.width, COLUMN, `${what}: expand width`)
    }
  } else {
    expect.soft(row.expand, `${what}: a number leaves the expand column empty`).toBeNull()
  }
  const center = middle(row.variable)
  for (const [part, rect] of Object.entries(row)) {
    if (rect) near(middle(rect as Rect), center, `${what}: ${part} center`)
  }
  for (const [part, rect] of [
    ['delete', row.remove],
    ['up', row.up],
    ['down', row.down],
  ] as const) {
    near(rect.width, COLUMN, `${what}: ${part} width`)
    near(rect.height, COLUMN, `${what}: ${part} height`)
  }
}

/** Criterion 3: the operator list takes the shared choice look. */
async function expectChoiceLook(operator: Locator, what: string): Promise<void> {
  const look = await operator.evaluate((el) => {
    const style = getComputedStyle(el)
    const chevron = el.querySelector('svg.lucide-chevron-down')
    return {
      radius: style.borderTopLeftRadius,
      border: style.borderTopWidth,
      shadow: style.boxShadow !== 'none',
      fill: style.backgroundColor,
      fontSize: style.fontSize,
      chevron: chevron === null ? null : getComputedStyle(chevron).opacity,
    }
  })
  expect.soft(look, `${what}: the shared choice look`).toEqual({
    radius: '8px',
    border: '1px',
    shadow: true,
    fill: 'rgba(0, 0, 0, 0)',
    fontSize: '14px',
    chevron: '0.5',
  })
}

/** Criteria 2, 3, 4, 5 and 7 over every row of both lists. */
async function expectRows(sheet: Locator): Promise<void> {
  const ifBody = body(sheet, IF_BRANCH)
  const slowBody = body(sheet, SLOW_BRANCH)
  const ready = await literalRow(ifBody, P.ready)
  const expected = await literalRow(ifBody, P.expected)
  const latency = await literalRow(slowBody, P.latency)
  const retries = await literalRow(slowBody, P.retries)
  const region = await literalRow(slowBody, P.region)
  expectLiteralRow(ready, 'IF ready', 'text')
  expectLiteralRow(expected, 'IF expected_status', 'text')
  expectLiteralRow(latency, 'ELSE IF latency_ms', 'number')
  expectLiteralRow(retries, 'group retries', 'number')
  expectLiteralRow(region, 'group region', 'text')
  for (const operator of [ifBody.getByTestId(`assert-operator-${P.ready}`), slowBody.getByTestId(`assert-operator-${P.retries}`)]) {
    await expectChoiceLook(operator, 'operator list')
  }

  // Criterion 4: one column per nesting level, the group's 13 px to the left.
  const topToggle = ready.toggle.x
  const topExpand = ready.expand?.x ?? Number.NaN
  for (const [what, row] of [
    ['IF expected_status', expected],
    ['ELSE IF latency_ms', latency],
  ] as const) {
    near(row.toggle.x, topToggle, `${what}: the top-level {x} column`)
    near(right(row.value), right(ready.value), `${what}: the top-level value edge`)
  }
  near(expected.expand?.x ?? Number.NaN, topExpand, 'IF expected_status: the top-level expand column')
  near(retries.toggle.x, region.toggle.x, 'group: one {x} column')
  near(right(retries.value), right(region.value), 'group: one value edge')
  near(region.toggle.x, topToggle - GROUP_INSET, 'group {x} column against the top level')
  near(region.expand?.x ?? Number.NaN, topExpand - GROUP_INSET, 'group expand column against the top level')

  // Criterion 7: the expression row.
  const errorsPath = P.errors
  const stem = `assert-expr-${errorsPath}`
  const marker = await rectOf(slowBody.getByTestId(`assert-expression-icon-${errorsPath}`), 'braces marker')
  const box = await rectOf(cellBox(slowBody, stem), 'expression box')
  const expand = await rectOf(expandButton(slowBody, stem), 'expression expand')
  const remove = await rectOf(slowBody.getByTestId(`assert-delete-${errorsPath}`), 'expression delete')
  const up = await rectOf(slowBody.getByTestId(`assert-move-up-${errorsPath}`), 'expression up')
  const down = await rectOf(slowBody.getByTestId(`assert-move-down-${errorsPath}`), 'expression down')
  await expect
    .soft(slowBody.getByTestId(`assert-row-${errorsPath}`).locator('[data-slot="expression-toggle"]'), 'no {x} on an expression row')
    .toHaveCount(0)
  near(box.height, 36, 'expression box height')
  near(box.x - right(marker), GAP, 'marker to expression box')
  near(expand.x, topExpand, 'expression expand in the top-level expand column')
  near(remove.x - right(expand), GAP + COLUMN + GAP, 'an empty {x} column before the actions')
  near(remove.x, ready.remove.x, 'expression actions in their column')
  for (const [part, rect] of [
    ['box', box],
    ['expand', expand],
    ['delete', remove],
    ['up', up],
    ['down', down],
  ] as const) {
    near(middle(rect), middle(marker), `expression row: ${part} center`)
  }
}

/** Criterion 6: value colors and the pressed {x}. */
async function expectColors(page: Page, sheet: Locator): Promise<void> {
  const ifBody = body(sheet, IF_BRANCH)
  const slowBody = body(sheet, SLOW_BRANCH)
  const stringColor = await resolvedColor(page, 'var(--color-sky-300)')
  const integerColor = await resolvedColor(page, 'var(--color-violet-400)')

  await expect(cellInput(ifBody, valueStem(P.ready))).toHaveValue('ready')
  await expect(cellInput(slowBody, valueStem(P.region))).toHaveValue('eu')
  await expect(cellInput(slowBody, valueStem(P.latency))).toHaveValue('500')
  await expect(cellInput(slowBody, valueStem(P.retries))).toHaveValue('3')
  for (const [what, target, color] of [
    ['ready', cellInput(ifBody, valueStem(P.ready)), stringColor],
    ['eu', cellInput(slowBody, valueStem(P.region)), stringColor],
    ['500', cellInput(slowBody, valueStem(P.latency)), integerColor],
    ['3', cellInput(slowBody, valueStem(P.retries)), integerColor],
  ] as const) {
    expect.soft(await elementColor(target, 'color'), `${what} color`).toBe(color)
  }
  for (const [what, scope, stem, text] of [
    ['expected_status', ifBody, valueStem(P.expected), 'expected_status'],
    ['len(errors) == 0', slowBody, `assert-expr-${P.errors}`, 'len(errors) == 0'],
  ] as const) {
    const code = expressionBox(scope, stem)
    await expect(code).toHaveText(text)
    const mark = cellInput(scope, stem).locator('.cm-expression').first()
    expect.soft(await elementColor(mark, 'color'), `${what}: the expression color`).toBe(CODE_EXPRESSION_COLOR)
    expect.soft(await styleOf(cellInput(scope, stem), 'box-shadow'), `${what}: the expression box has no shadow`).toBe('none')
  }

  const pressed = ifBody.getByTestId(`assert-expr-toggle-${P.expected}`)
  await expect(pressed).toHaveAttribute('aria-pressed', 'true')
  expect.soft(await styleOf(pressed, 'background-color'), 'pressed {x} fill').toBe(await fillOf(page, PRESSED_FILL))
  expect.soft(await elementColor(pressed, 'color'), 'pressed {x} icon').toBe(await resolvedColor(page, 'var(--color-primary)'))
  const unpressed = ifBody.getByTestId(`assert-expr-toggle-${P.ready}`)
  await expect(unpressed).toHaveAttribute('aria-pressed', 'false')
  expect.soft(await styleOf(unpressed, 'background-color'), 'unpressed {x} has no fill').toBe('rgba(0, 0, 0, 0)')
}

/** Criterion 8: cards, pills, the group and the buttons, in order. */
async function expectStructure(sheet: Locator): Promise<void> {
  const cards = sheet.locator('[data-testid^="branch-card-"]')
  await expect(cards).toHaveCount(3)
  const cardIds = await cards.evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')))
  expect(cardIds).toEqual([`branch-card-${IF_BRANCH}`, `branch-card-${SLOW_BRANCH}`, `branch-card-${ELSE_BRANCH}`])
  for (const [branch, badge, label] of [
    [IF_BRANCH, 'IF', 'Healthy'],
    [SLOW_BRANCH, 'ELSE IF', 'Slow'],
    [ELSE_BRANCH, 'ELSE', 'Fallback'],
  ] as const) {
    await expect.soft(sheet.getByTestId(`branch-badge-${branch}`)).toHaveText(badge)
    await expect.soft(sheet.getByTestId(`branch-label-${branch}`)).toHaveValue(label)
    await expect.soft(sheet.getByTestId(`branch-alert-${branch}`), `${badge}: no warning mark`).toHaveCount(0)
  }
  await expect.soft(sheet.getByTestId(`branch-delete-${IF_BRANCH}`), 'IF has no delete').toHaveCount(0)
  await expect.soft(sheet.getByTestId(`branch-delete-${SLOW_BRANCH}`)).toBeEnabled()
  await expect.soft(sheet.getByTestId(`branch-delete-${ELSE_BRANCH}`)).toBeEnabled()
  await expect.soft(sheet.getByTestId(`branch-move-up-${SLOW_BRANCH}`)).toBeDisabled()
  await expect.soft(sheet.getByTestId(`branch-move-down-${SLOW_BRANCH}`)).toBeDisabled()
  await expect.soft(body(sheet, ELSE_BRANCH)).toHaveText('Catch-all branch - no conditions needed')

  const ifBody = body(sheet, IF_BRANCH)
  const slowBody = body(sheet, SLOW_BRANCH)
  await expect.soft(ifBody.locator('[data-testid^="assert-row-"]')).toHaveCount(2)
  await expect.soft(slowBody.locator('[data-testid^="assert-row-"]')).toHaveCount(4)
  await expect.soft(ifBody.locator('[data-testid^="assert-operator-toggle-"]')).toHaveText(['OR'])
  await expect.soft(slowBody.locator('[data-testid^="assert-operator-toggle-root-"]')).toHaveText(['AND', 'AND'])
  await expect.soft(slowBody.getByTestId(`assert-operator-toggle-${RETRIES_GROUP}-1`)).toHaveText('OR')
  const pill = await rectOf(ifBody.getByTestId('assert-operator-toggle-root-1'), 'IF pill')
  const root = await rectOf(ifBody.getByTestId('assertion-builder-root'), 'IF list')
  near(pill.x + pill.width / 2, root.x + root.width / 2, 'the pill is centered')

  const group = slowBody.getByTestId(`assert-group-${RETRIES_GROUP}`)
  await expect.soft(group).toHaveCSS('border-top-style', 'dashed')
  for (const id of ['add-assertion', 'add-group', 'delete', 'move-up', 'move-down']) {
    await expect.soft(group.getByTestId(`assert-group-${id}-${RETRIES_GROUP}`), `group footer ${id}`).toBeVisible()
  }
  for (const scope of [ifBody, slowBody]) {
    await expect.soft(scope.getByTestId('assert-add-assertion')).toHaveText('Add Assertion')
    await expect.soft(scope.getByTestId('assert-add-group')).toHaveText('Add Group')
  }
  await expect.soft(sheet.getByTestId('add-else-if-button')).toHaveText('Else If')
  await expect.soft(sheet.getByTestId('add-else-if-button')).toBeEnabled()
  await expect.soft(sheet.getByTestId('add-else-button'), 'Else is held: the list has one').toBeDisabled()

  const footer = ['Changelog', 'Details', 'Profiles', 'Cancel', 'Save']
  const xs: number[] = []
  for (const name of footer) xs.push((await rectOf(sheet.getByRole('button', { name, exact: true }), name)).x)
  expect.soft(xs, `footer order ${footer.join(', ')}`).toEqual([...xs].sort((a, b) => a - b))
}

/** Criterion 9: the errors built in the window, never saved. */
async function expectErrors(page: Page, sheet: Locator): Promise<void> {
  const ifBody = body(sheet, IF_BRANCH)
  const destructive = await resolvedColor(page, 'var(--destructive)')
  const label = sheet.getByTestId(`branch-label-${IF_BRANCH}`)
  const labelBefore = await rectOf(label, 'IF label before')
  const rowBefore = await rectOf(ifBody.getByTestId(`assert-row-${P.expected}`), 'expected_status row before')
  const readyRow = await rectOf(ifBody.getByTestId(`assert-row-${P.ready}`), 'ready row')
  const readyBorder = await styleOf(cellBox(ifBody, valueStem(P.ready)), 'border-top-color')

  await ifBody.getByTestId('assert-add-assertion').click()
  await ifBody.getByTestId('assert-add-literal').click()
  const fresh = '4'
  await expect(ifBody.getByTestId(`assert-row-${fresh}`)).toBeVisible()
  await replaceCode(page, expressionBox(ifBody, valueStem(P.expected)), '')
  await sheet.getByTestId('element-description-input').focus()

  const variable = ifBody.getByTestId(`assert-variable-${fresh}`)
  await expect(variable).toHaveValue('')
  await expect(variable).toHaveAttribute('placeholder', 'variable')
  expect.soft(await elementColor(variable, 'borderTopColor'), 'the empty variable box is red').toBe(destructive)
  const variableLine = ifBody.getByTestId(`assert-variable-error-${fresh}`)
  await expect(variableLine).toHaveText('Choose a variable.')
  await expect(variableLine).toHaveAttribute('role', 'alert')
  await expectMessageLook(variableLine, 'Choose a variable.')
  expect.soft(await elementColor(variableLine, 'color'), 'Choose a variable. is destructive').toBe(destructive)
  const variableBox = await rectOf(variable, 'fresh variable box')
  const variableText = await rectOf(variableLine, 'Choose a variable.')
  near(variableText.y, bottom(variableBox) + MESSAGE_GAP, 'Choose a variable. sits 4 px under the box')
  near(variableText.x, variableBox.x, 'Choose a variable. starts at the box')
  await expect.soft(cellError(ifBody, valueStem(fresh)), 'one message per row').toHaveCount(0)
  expect
    .soft(await styleOf(cellBox(ifBody, valueStem(fresh)), 'border-top-color'), 'the fresh value box keeps its border')
    .toBe(readyBorder)
  await expect.soft(expandButton(ifBody, valueStem(fresh)), 'a fresh text value shows its expand').toBeVisible()

  const expectedBox = cellBox(ifBody, valueStem(P.expected))
  await expect(ifBody.getByTestId(`assert-expr-toggle-${P.expected}`)).toHaveAttribute('aria-pressed', 'true')
  expect.soft(await elementColor(expectedBox, 'borderTopColor'), 'the blank {x} box is red').toBe(destructive)
  await expect.soft(expandButton(ifBody, valueStem(P.expected)), 'the blank {x} keeps its expand').toBeVisible()
  const valueLine = cellError(ifBody, valueStem(P.expected))
  await expect(valueLine).toHaveText('Value is required')
  await expectMessageLook(valueLine, 'Value is required')
  expect.soft(await elementColor(valueLine, 'color'), 'Value is required is destructive').toBe(destructive)
  const box = await rectOf(expectedBox, 'blank {x} box')
  const valueText = await rectOf(valueLine, 'Value is required')
  near(valueText.y, bottom(box) + MESSAGE_GAP, 'Value is required sits 4 px under the box')
  near(valueText.x, box.x, 'Value is required starts at the box')

  const grownRow = await rectOf(ifBody.getByTestId(`assert-row-${P.expected}`), 'expected_status row after')
  const freshRow = await rectOf(ifBody.getByTestId(`assert-row-${fresh}`), 'fresh row')
  near(grownRow.height, rowBefore.height + GROWTH, 'the {x} row grows 20 px')
  near(freshRow.height, readyRow.height + GROWTH, 'the fresh row grows 20 px')
  const pillUnder = await rectOf(ifBody.getByTestId('assert-operator-toggle-root-2'), 'pill under the {x} row')
  expect.soft(pillUnder.y, 'the pill starts at or below Value is required').toBeGreaterThanOrEqual(bottom(valueText) - 0.5)
  expect.soft(bottom(variableText), 'Choose a variable. stays inside its row').toBeLessThanOrEqual(bottom(freshRow) + 0.5)

  const mark = sheet.getByTestId(`branch-alert-${IF_BRANCH}`)
  await expect(mark).toBeVisible()
  const badge = await rectOf(sheet.getByTestId(`branch-badge-${IF_BRANCH}`), 'IF badge')
  const markBox = await rectOf(mark, 'IF warning mark')
  near(markBox.width, 16, 'warning mark width')
  near(markBox.x - right(badge), GAP, 'the mark follows the IF badge')
  near((await rectOf(label, 'IF label after')).x - labelBefore.x, markBox.width + GAP, 'the label moves by the mark')
  expect.soft(await elementColor(mark, 'color'), 'the warning mark is destructive').toBe(destructive)

  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(settingsNote(sheet)).toHaveText(SAVE_NOTE)
}

test.describe('V-CTRL-CONDROW-01: the condition row', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await deleteControlTest(request, testId)
    testId = ''
  })

  for (const theme of THEMES) {
    test(`the condition rows of Route by health in the ${theme} theme`, async ({ page, request }, testInfo) => {
      testId = await seedControlTest(request, 'condrow', theme)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const sheet = await openControlWindow(page, IF_ELSE_ID, IF_ELSE_LABEL)
      await attachWindow(testInfo, `condition-row-${theme}.png`, sheet)

      await test.step('1. the window opens 880 px wide', async () => {
        near((await rectOf(configSheet(page), 'window')).width, WIDE_WINDOW, 'window width')
      })
      await test.step('2-5, 7. row geometry and columns', () => expectRows(sheet))
      await test.step('6. value colors and the pressed {x}', () => expectColors(page, sheet))
      await test.step('8. cards, pills, group and buttons', () => expectStructure(sheet))
      await test.step('9. errors built in the window', () => expectErrors(page, sheet))
      await attachWindow(testInfo, `condition-row-errors-${theme}.png`, sheet)

      await discardBlockSheet(page, sheet)
    })
  }
})
