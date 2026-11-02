/**
 * V-FIELD-BLOCK-STATES: the one value field and its states on a Function Block window
 * Design Decisions: FIELD-1, FIELD-2, FIELD-3, FIELD-4, FIELD-5, FIELD-6, FIELD-8, CANVAS-207
 * REQ: REQ-3.1.1.5, REQ-3.1.2.1, REQ-3.1.3.20, REQ-3.1.3.21
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-11541-s1-` Test holding the Local Function Block
 * `deploy_check` (inputs region, owner, prefix, note, tags, targets, env) and the Test variable `backup_host`;
 * each test seeds its own Test, checks it validates with zero errors and deletes it afterwards.
 * One test per theme: the dark project's theme, then the light theme through the shell toggle.
 *
 * Pass Criteria (in both themes):
 * 1. The window reads `deploy_check - Edit Config` with the Function icon; Name `deploy_check`; Description
 *    placeholder `Optional. Per-instance description for this Function.`; INPUT PARAMETERS with the columns
 *    Parameter / Type / Value and the rows region, owner, prefix, note, tags, targets, env in that order, each
 *    with its (i) and type, `env` with the red star; OUTPUT VARIABLES reads `This Function declares no outputs.`;
 *    the footer holds Profiles, then Cancel and a disabled Save.
 * 2. After every value field sit two fixed columns: expand (two diagonal arrows) then {x}; the field edges and
 *    both columns line up on every row; the choice list `env` leaves the expand column empty and keeps {x}.
 * 3. `region` shows `eu-west-1` and `tags` `["smoke"]`: upright, Text Muted, real text that select-all takes
 *    whole, with no reset and no ∅; neither is in the stored Test.
 * 4. Delete and Backspace on `region` show `Not set, so the default is used. Type to use your own value.`
 *    above the field and change nothing; Save stays disabled.
 * 5. `owner` holds `qa-team` in the string color with the counterclockwise `Reset to default` icon inside the
 *    field at its right end.
 * 6. `prefix` shows `<empty string>` italic in Text Muted, not selectable, with its ∅ inside, not pressed.
 * 7. `note` shows `null` italic monospace in Text Muted with its ∅ inside the field at the right end, pressed:
 *    tinted background and the primary color.
 * 8. `targets` shows `["web-1", {{ backup_host }}, "web-3"]` drawn once on one line: `{{ backup_host }}`
 *    in the expression color without quotes, the rest in the list color with quotes; a key shows
 *    `Has {{ }} entries. Open the editor to change it.` above the field and changes nothing.
 * 9. `env` holds `staging` in a normal color with its chevron: no gray, no reset, no expand.
 * 10. One gray: the gray default, the {x} hint `'eu-west-1'` (region switched to {x} with no question, and back),
 *     `null` and `<empty string>` all compute to Text Muted (`--color-text-muted`).
 * 11. Closing the window without saving leaves the stored Test as seeded.
 * 12. A screenshot of the window in each theme is attached.
 */

import { test, expect, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { elementColor, paramRow, requiredStar, resolvedColor } from '../../helpers/config-sheet'
import { openTest } from '../../helpers/fn-seed'
import { toggleTheme } from '../../helpers/theme'
import {
  DEFAULT_KEY_HINT,
  ENTRIES_KEY_HINT,
  expandButton,
  expressionHint,
  expressionToggle,
  fieldBox,
  fieldInput,
  fieldOverlay,
  fieldTooltip,
  nullButton,
  pressForHint,
  resetButton,
  stateMarker,
  switchWarning,
  textLook,
  textMuted,
} from '../../helpers/value-field'
import {
  DEPLOY_CHECK,
  DEPLOY_CHECK_ROWS,
  DEPLOY_CHECK_VALUES,
  FREE_ENTRY_ROWS,
  TARGETS_LINE,
  deleteSeededTest,
  openDeployCheckWindow,
  seedDeployCheck,
  storedDeployCheck,
} from './deploy-check-seed'

type Theme = 'dark' | 'light'

const TYPES: Record<(typeof DEPLOY_CHECK_ROWS)[number], string> = {
  region: 'String',
  owner: 'String',
  prefix: 'String',
  note: 'String',
  tags: 'Array',
  targets: 'Array',
  env: 'String',
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

async function box(target: Locator, what: string): Promise<Rect> {
  const found = await target.boundingBox()
  expect(found, `${what} has a box`).not.toBeNull()
  return found!
}

const near = (actual: number, expected: number, what: string, tolerance = 1): void => {
  expect(Math.abs(actual - expected), `${what}: ${actual} vs ${expected}`).toBeLessThanOrEqual(tolerance)
}

/** The raw computed background of an element, transparent included. */
const background = (target: Locator): Promise<string> =>
  target.evaluate((el) => getComputedStyle(el).backgroundColor)

const isTransparent = (color: string): boolean => /^rgba\(.*,\s*0\)$|^transparent$/.test(color)

/** Criterion 1: the Function Block window chrome (CANVAS-207). */
async function expectChrome(sheet: Locator): Promise<void> {
  const title = sheet.locator('h2').first()
  await expect(title).toHaveText(`${DEPLOY_CHECK} - Edit Config`)
  await expect(title.locator('svg.lucide-square-function'), 'the Function icon leads the title').toHaveCount(1)
  await expect(sheet.getByRole('button', { name: 'Close', exact: true })).toBeVisible()
  await expect(sheet.locator('[data-testid="function-name-input"]')).toHaveValue(DEPLOY_CHECK)
  const description = sheet.locator('[data-testid="element-description-input"]')
  await expect(description).toHaveValue('')
  await expect(description).toHaveAttribute('placeholder', 'Optional. Per-instance description for this Function.')

  const headings = sheet.locator('h3')
  await expect(headings.filter({ hasText: /^Input Parameters$/ })).toHaveText('INPUT PARAMETERS', { useInnerText: true })
  await expect(headings.filter({ hasText: /^Output Variables$/ })).toHaveText('OUTPUT VARIABLES', { useInnerText: true })
  await expect(sheet.locator('table').first().locator('thead th')).toHaveText(['', 'Parameter', 'Type', 'Value'])

  const rows = sheet.locator('[data-testid^="param-row-"]')
  await expect(rows).toHaveCount(DEPLOY_CHECK_ROWS.length)
  const names = await rows.evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').slice(10)))
  expect(names, 'the inputs in declared order').toEqual([...DEPLOY_CHECK_ROWS])
  for (const name of DEPLOY_CHECK_ROWS) {
    const row = paramRow(sheet, name)
    await expect(row.locator('td:nth-child(1) svg.lucide-info'), `${name} has its (i)`).toHaveCount(1)
    await expect(row.locator('td:nth-child(3) span'), `${name} type`).toHaveText(TYPES[name], { useInnerText: true })
    await expect(requiredStar(sheet, name), `${name} star`).toHaveCount(name === 'env' ? 1 : 0)
  }
  await expect(requiredStar(sheet, 'env')).toHaveText('*')

  await expect(sheet.locator('[data-testid="function-empty-section-outputs"]')).toHaveText(
    'This Function declares no outputs.',
  )
  const profiles = sheet.getByRole('button', { name: 'Profiles', exact: true })
  const cancel = sheet.getByRole('button', { name: 'Cancel', exact: true })
  const save = sheet.getByRole('button', { name: 'Save', exact: true })
  await expect(save, 'Save waits for a change').toBeDisabled()
  const [profilesBox, cancelBox, saveBox] = [await box(profiles, 'Profiles'), await box(cancel, 'Cancel'), await box(save, 'Save')]
  expect(profilesBox.x, 'Profiles sits left of Cancel').toBeLessThan(cancelBox.x)
  expect(cancelBox.x, 'Cancel sits left of Save').toBeLessThan(saveBox.x)
}

/** Criterion 2: field, expand, then {x}, the same columns on every row (FIELD-1). */
async function expectIconColumns(sheet: Locator): Promise<void> {
  const toggles: Rect[] = []
  const fields: Rect[] = []
  const expands: Rect[] = []
  for (const name of DEPLOY_CHECK_ROWS) {
    const toggle = expressionToggle(sheet, name)
    await expect(toggle.locator('svg.lucide-braces'), `${name}: {x}`).toHaveCount(1)
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')
    const field = await box(fieldBox(sheet, name), `${name} field`)
    const toggleBox = await box(toggle, `${name} {x}`)
    fields.push(field)
    toggles.push(toggleBox)
    if (name === 'env') {
      await expect(expandButton(sheet, name), 'the choice list has no expand').toHaveCount(0)
      continue
    }
    const expand = expandButton(sheet, name)
    await expect(expand).toHaveAccessibleName(`Open editor for ${name}`)
    await expect(expand.locator('svg.lucide-maximize-2'), `${name}: two diagonal arrows`).toHaveCount(1)
    const expandBox = await box(expand, `${name} expand`)
    expands.push(expandBox)
    expect(expandBox.x, `${name}: expand sits right of the field`).toBeGreaterThanOrEqual(field.x + field.width)
    expect(toggleBox.x, `${name}: {x} sits right of expand`).toBeGreaterThanOrEqual(expandBox.x + expandBox.width)
  }
  for (const [index, name] of DEPLOY_CHECK_ROWS.entries()) {
    near(fields[index].x + fields[index].width, fields[0].x + fields[0].width, `${name}: the field ends in line`)
    near(toggles[index].x, toggles[0].x, `${name}: the {x} column`)
  }
  for (const [index, name] of FREE_ENTRY_ROWS.entries()) near(expands[index].x, expands[0].x, `${name}: the expand column`)
}

/** Criteria 3 and 4: the gray default, upright and whole, and its tooltip on Delete / Backspace (FIELD-2). */
async function expectGrayDefaults(page: Page, sheet: Locator): Promise<void> {
  for (const [name, shown] of [
    ['region', 'eu-west-1'],
    ['tags', '["smoke"]'],
  ] as const) {
    const input = fieldInput(sheet, name)
    await expect(input, `${name} shows its default`).toHaveValue(shown)
    expect((await textLook(input)).fontStyle, `${name}: the default is upright`).toBe('normal')
    await expect(input).not.toHaveAttribute('readonly', /.*/)
    await expect(resetButton(sheet, name), `${name}: not set, so no reset`).toHaveCount(0)
    await expect(nullButton(sheet, name), `${name}: a default, so no ∅`).toHaveCount(0)
  }
  const region = fieldInput(sheet, 'region')
  await region.click()
  await page.keyboard.press('ControlOrMeta+a')
  expect(
    await region.evaluate((el: HTMLInputElement) => [el.selectionStart, el.selectionEnd]),
    'select-all takes the whole gray text',
  ).toEqual([0, 'eu-west-1'.length])

  const save = sheet.getByRole('button', { name: 'Save', exact: true })
  for (const key of ['Delete', 'Backspace']) {
    const tooltip = await pressForHint(page, sheet, 'region', key, DEFAULT_KEY_HINT)
    const tip = await box(tooltip, 'the tooltip')
    const field = await box(fieldBox(sheet, 'region'), 'region field')
    expect(tip.y + tip.height, 'the tooltip sits above region').toBeLessThanOrEqual(field.y + 1)
    await expect(region, `${key} changes nothing`).toHaveValue('eu-west-1')
    await expect(resetButton(sheet, 'region')).toHaveCount(0)
    await expect(save, `${key} is no change`).toBeDisabled()
  }
  await blurField(page, sheet, 'region')
}

/** Move focus off a field so its key tooltip closes. */
async function blurField(page: Page, sheet: Locator, name: string): Promise<void> {
  await sheet.locator('[data-testid="element-description-input"]').focus()
  await expect(fieldTooltip(page, name)).toHaveCount(0)
}

/** Criterion 5: a user value in its type color with the reset icon inside, at the right end (FIELD-3). */
async function expectReset(page: Page, sheet: Locator): Promise<void> {
  const owner = fieldInput(sheet, 'owner')
  await expect(owner).toHaveValue('qa-team')
  expect(await elementColor(owner, 'color'), 'owner takes the string color').toBe(
    await resolvedColor(page, 'var(--color-sky-300)'),
  )
  const reset = resetButton(sheet, 'owner')
  await expect(reset).toHaveAccessibleName('Reset to default')
  await expect(reset.locator('svg.lucide-rotate-ccw'), 'a counterclockwise arrow').toHaveCount(1)
  await expectInsideRightEnd(sheet, 'owner', reset)
  await expect(nullButton(sheet, 'owner'), 'reset never sits beside ∅').toHaveCount(0)
}

async function expectInsideRightEnd(sheet: Locator, name: string, control: Locator): Promise<void> {
  const field = await box(fieldBox(sheet, name), `${name} field`)
  const inner = await box(control, `${name} button`)
  expect(inner.x, `${name}: the button is inside the field`).toBeGreaterThan(field.x)
  const gap = field.x + field.width - (inner.x + inner.width)
  expect(gap, `${name}: the button sits at the field's right end`).toBeGreaterThanOrEqual(0)
  expect(gap, `${name}: the button sits at the field's right end`).toBeLessThanOrEqual(12)
  near(inner.y + inner.height / 2, field.y + field.height / 2, `${name}: the button is centered in the field`, 2)
}

/** Criteria 6 and 7: `<empty string>` and `null`, italic Text Muted, and their ∅ (FIELD-4, FIELD-5). */
async function expectEmptyAndNull(page: Page, sheet: Locator): Promise<void> {
  const empty = stateMarker(sheet, 'prefix')
  await expect(empty).toHaveText('<empty string>')
  expect(await textLook(empty), '<empty string> is italic and not selectable').toMatchObject({
    fontStyle: 'italic',
    userSelect: 'none',
  })
  const prefixNull = nullButton(sheet, 'prefix')
  await expect(prefixNull, 'an optional input with no default keeps its ∅').toHaveAttribute('aria-pressed', 'false')
  expect(isTransparent(await background(prefixNull)), 'an unpressed ∅ has no tint').toBe(true)
  await expect(resetButton(sheet, 'prefix')).toHaveCount(0)

  const nullText = stateMarker(sheet, 'note')
  await expect(nullText).toHaveText('null')
  expect(await textLook(nullText), 'null is italic monospace').toMatchObject({ fontStyle: 'italic', monospace: true })
  const noteNull = nullButton(sheet, 'note')
  await expect(noteNull).toHaveText('∅')
  await expect(noteNull).toHaveAccessibleName('Set note to null')
  await expect(noteNull, 'the ∅ of a null field is pressed').toHaveAttribute('aria-pressed', 'true')
  expect(isTransparent(await background(noteNull)), 'the pressed ∅ is tinted').toBe(false)
  expect(await elementColor(noteNull, 'color'), 'the pressed ∅ takes the primary color').toBe(
    await resolvedColor(page, 'var(--color-primary)'),
  )
  await expectInsideRightEnd(sheet, 'note', noteNull)
  await expect(fieldInput(sheet, 'note'), 'the box under null is empty').toHaveValue('')
}

/** Criterion 8: the `{{ }}` entries line, drawn once, and its tooltip on any key (FIELD-6). */
async function expectEntriesLine(page: Page, sheet: Locator): Promise<void> {
  const input = fieldInput(sheet, 'targets')
  await expect(input, 'the box holds the line for copy').toHaveValue(TARGETS_LINE)
  expect(
    await input.evaluate((el) => getComputedStyle(el).color),
    'the box text is clear, so the line is drawn once',
  ).toMatch(/^rgba\(.*,\s*0\)$/)
  const line = fieldOverlay(sheet, 'targets')
  await expect(line).toHaveCount(1)
  await expect(line).toHaveText(TARGETS_LINE)
  const shape = await line.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      whiteSpace: style.whiteSpace,
      textOverflow: style.textOverflow,
      lines: Math.round(el.getBoundingClientRect().height / Number.parseFloat(style.lineHeight)),
    }
  })
  expect(shape, 'one readable line, cut with "…" at the field edge').toEqual({
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    lines: 1,
  })
  const parts = line.locator(':scope > span')
  await expect(parts).toHaveText(['["web-1", ', '{{ backup_host }}', ', "web-3"]'])
  const listColor = await resolvedColor(page, 'var(--color-amber-300)')
  const expressionColor = await resolvedColor(page, 'var(--color-cyan-400)')
  expect(await elementColor(parts.nth(0), 'color'), 'the plain entries take the list color').toBe(listColor)
  expect(await elementColor(parts.nth(1), 'color'), 'the {x} entry takes the expression color').toBe(expressionColor)
  expect(await elementColor(parts.nth(2), 'color'), 'the plain entries take the list color').toBe(listColor)

  const tooltip = await pressForHint(page, sheet, 'targets', 'x', ENTRIES_KEY_HINT)
  const tip = await box(tooltip, 'the tooltip')
  const field = await box(fieldBox(sheet, 'targets'), 'targets field')
  expect(tip.y + tip.height, 'the tooltip sits above targets').toBeLessThanOrEqual(field.y + 1)
  await expect(input, 'a key changes nothing').toHaveValue(TARGETS_LINE)
  await expect(line).toHaveText(TARGETS_LINE)
  await blurField(page, sheet, 'targets')
}

/** Criterion 9: the choice list holds its creation value, never gray (FIELD-8). */
async function expectChoice(page: Page, sheet: Locator): Promise<void> {
  const trigger = paramRow(sheet, 'env').locator('button[role="combobox"]')
  await expect(trigger).toHaveText('staging')
  await expect(trigger.locator('svg.lucide-chevron-down'), 'the choice list chevron').toHaveCount(1)
  expect(await elementColor(trigger, 'color'), 'staging is not gray').not.toBe(await textMuted(page))
  await expect(resetButton(sheet, 'env'), 'a choice list has no reset').toHaveCount(0)
  await expect(nullButton(sheet, 'env')).toHaveCount(0)
}

/** Criterion 10: one gray for the default, the {x} hint, null and `<empty string>` (FIELD-2, FIELD-4, FIELD-5). */
async function expectOneGray(page: Page, sheet: Locator): Promise<void> {
  const muted = await textMuted(page)
  expect(muted, 'Text Muted').toBe('#71717a')
  const grays: Array<[string, Locator]> = [
    ['the gray default of region', fieldInput(sheet, 'region')],
    ['the gray default of tags', fieldInput(sheet, 'tags')],
    ['null', stateMarker(sheet, 'note')],
    ['<empty string>', stateMarker(sheet, 'prefix')],
  ]
  for (const [what, target] of grays) expect(await elementColor(target, 'color'), `${what} is Text Muted`).toBe(muted)

  const toggle = expressionToggle(sheet, 'region')
  await toggle.click()
  await expect(toggle, 'a field not set switches with no question').toHaveAttribute('aria-pressed', 'true')
  await expect(switchWarning(page)).toHaveCount(0)
  const hint = expressionHint(sheet, 'region')
  await expect(hint).toHaveText("'eu-west-1'")
  expect(await elementColor(hint, 'color'), 'the {x} hint is Text Muted').toBe(muted)

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(switchWarning(page)).toHaveCount(0)
  await expect(fieldInput(sheet, 'region'), 'back in plain mode the field is still not set').toHaveValue('eu-west-1')
  expect(await elementColor(fieldInput(sheet, 'region'), 'color')).toBe(muted)
}

/** Cancel the window, discarding whatever the question offers. */
async function closeWindow(page: Page, sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).click()
  const question = page.locator('[data-testid="unsaved-changes-dialog"]')
  await expect(async () => {
    if (await question.isVisible()) return
    await expect(sheet).toHaveCount(0, { timeout: 500 })
  }).toPass({ timeout: 10_000 })
  if (await question.isVisible()) {
    await question.locator('[data-testid="unsaved-close"]').click()
    await expect(question).toBeHidden()
  }
  await expect(sheet).toHaveCount(0)
}

async function attach(testInfo: TestInfo, name: string, sheet: Locator): Promise<void> {
  await testInfo.attach(name, { body: await sheet.screenshot(), contentType: 'image/png' })
}

test.describe('V-FIELD-BLOCK-STATES: the one value field on a Function Block window', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await deleteSeededTest(request, testId)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
    test(`every field state of deploy_check in the ${theme} theme`, async ({ page, request }, testInfo) => {
      testId = await seedDeployCheck(request, 'block-states')
      const stored = await storedDeployCheck(request, testId)
      expect(stored.values, 'region and tags are not set, so not stored').toEqual(DEPLOY_CHECK_VALUES)
      expect(stored.expressionFields).toEqual(['targets.1'])

      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const sheet = await openDeployCheckWindow(page)
      await attach(testInfo, `field-block-states-${theme}.png`, sheet)

      await test.step('window chrome', () => expectChrome(sheet))
      await test.step('icon columns', () => expectIconColumns(sheet))
      await test.step('reset icon', () => expectReset(page, sheet))
      await test.step('<empty string> and null', () => expectEmptyAndNull(page, sheet))
      await test.step('choice list', () => expectChoice(page, sheet))
      await test.step('gray defaults and their tooltip', () => expectGrayDefaults(page, sheet))
      await test.step('{{ }} entries line and its tooltip', () => expectEntriesLine(page, sheet))
      await test.step('one gray', () => expectOneGray(page, sheet))

      await closeWindow(page, sheet)
      const after = await storedDeployCheck(request, testId)
      expect(after, 'closing without saving stores nothing').toEqual(stored)
    })
  }
})
