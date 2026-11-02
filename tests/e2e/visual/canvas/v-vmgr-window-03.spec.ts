/**
 * V-VMGR-WIN-03: the input parameter window - enum New, Default just made an enum, Current, plain Required
 * Design Decisions: VMGR-108, VMGR-111, VMGR-112, VMGR-113, VMGR-114, FIELD-12
 * REQ: REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.24
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-` Test holding two Local Functions, `NewInputs` (empty)
 * and `EditInputs` (one optional String input `env` with the default `local`); each test seeds its own Test,
 * checks it validates with zero errors and deletes it afterwards. One test per theme: the dark project's
 * theme, then the light theme through the shell toggle.
 *
 * Pass Criteria (each frame, in both themes):
 * 1. The input window is 560 px wide; the header reads `New input parameter` / `Edit input parameter` with
 *    the green `IN` badge right before the close X.
 * 2. `Description` labels an 80 px textarea with the placeholder `What this parameter is for` and a resize
 *    grip; Type is a half-width select reading `String` with `Text value`, with no Kind.
 * 3. The checkboxes read, in order, `Required (the Function Block must set a value)`, `Mark as secret (value
 *    will be masked)`, `Set to null`, `Create enum (limit the Function Block to a fixed set of values)`.
 * 4. Enum New: Required ticked and locked with `locked on while enum is set`, Mark as secret and Set to null
 *    unticked and locked with `off while enum is set`, Create enum ticked; `Allowed values` comes right after
 *    Create enum as one line `["dev", "staging", "prod"]` in the list color with its Open editor button;
 *    `Default value` is the select reading `dev`; Name, Allowed values and Default value each end with the red
 *    star; Cancel then Create, Create enabled and the input is created.
 * 5. Edit, a String input just made an enum: `Value` with the indigo `Default` pill; the select is empty
 *    (`Select…`) with the red error border and the red `Default value is required` under it; Save is
 *    disabled until an allowed value is picked.
 * 6. Edit with Current: `Value` with the amber `Current` pill; the select reads the picked `staging`; Name,
 *    Description and Type stay editable; Save is enabled.
 * 7. Plain Required input: Required ticked and enabled, Mark as secret unticked and enabled, Set to null
 *    unticked and locked with `off while Required is set`, Create enum unticked; `Default value` is an empty
 *    field with no placeholder and its Open editor button; Name carries the red star and Default value none;
 *    Create is enabled.
 * 8. A screenshot of each frame in each theme is attached.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '../../helpers/playwright-fixtures'
import { BACKEND_URL } from '../../helpers/config'
import { elementColor, resolvedColor } from '../../helpers/config-sheet'
import { createValidTest, localFunctionNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { toggleTheme } from '../../helpers/theme'
import {
  cancelWindow,
  createWindowOrder,
  openEditWindow,
  openFunctionCreateModal,
  saveWindow,
  setAllowedValues,
  setCreateName,
  setWindowCheckbox,
  setWindowValue,
  valueField,
  valueSwitch,
  variableRow,
  windowCancelButton,
  windowCheckbox,
  windowSaveButton,
} from '../../helpers/variable-create'
import { breadcrumbFunctionSegments, digIn, popToBreadcrumbSegment } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'
type Box = 'required' | 'secret' | 'set-to-null' | 'create-enum'

const FN_NEW = 'fn-win-03-new'
const FN_EDIT = 'fn-win-03-edit'
const ALLOWED = '["dev", "staging", "prod"]'

const CHECKBOX_LABELS: Record<Box, string> = {
  required: 'Required (the Function Block must set a value)',
  secret: 'Mark as secret (value will be masked)',
  'set-to-null': 'Set to null',
  'create-enum': 'Create enum (limit the Function Block to a fixed set of values)',
}
const CHECKBOX_ORDER: Box[] = ['required', 'secret', 'set-to-null', 'create-enum']

/** The pill's and the IN badge's text color per theme. */
const TEXT_COLOR: Record<Theme, Record<'Default' | 'Current' | 'IN', string>> = {
  dark: { Default: 'var(--color-indigo-300)', Current: 'var(--color-amber-300)', IN: 'var(--color-emerald-300)' },
  light: { Default: 'var(--color-indigo-700)', Current: 'var(--color-amber-700)', IN: 'var(--color-emerald-700)' },
}

/** A checkbox row's expected state: ticked, locked (with its italic note) or free. */
interface RowState {
  ticked: boolean
  note?: string
}

const ENUM_ROWS: Record<Box, RowState> = {
  required: { ticked: true, note: 'locked on while enum is set' },
  secret: { ticked: false, note: 'off while enum is set' },
  'set-to-null': { ticked: false, note: 'off while enum is set' },
  'create-enum': { ticked: true },
}

const REQUIRED_ROWS: Record<Box, RowState> = {
  required: { ticked: true },
  secret: { ticked: false },
  'set-to-null': { ticked: false, note: 'off while Required is set' },
  'create-enum': { ticked: false },
}

const control = (win: Locator, id: string): Locator => win.locator(`[data-testid="${id}"]`)
// A required label ends with the red star and its screen-reader word (FIELD-12).
const fieldLabel = (win: Locator, text: string): Locator =>
  win.locator('label').filter({ hasText: new RegExp(`^${text}(\\* required)?$`) })

/** FIELD-12: the label ends with the red star (screen readers hear "required"), or carries none. */
async function expectStar(label: Locator, required: boolean): Promise<void> {
  const star = label.locator('span[aria-hidden="true"]')
  if (!required) {
    await expect(label.locator('.sr-only'), 'no required mark').toHaveCount(0)
    return
  }
  await expect(star).toHaveText('*')
  expect(await elementColor(star, 'color'), 'the star is red').toBe(await resolvedColor(label.page(), 'var(--destructive)'))
  await expect(label.locator('.sr-only')).toHaveText(' required')
}
const enumTrigger = (win: Locator): Locator => control(win, 'enum-value-select').getByRole('combobox')

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

async function colorOf(target: Locator, token: string, what: string, prop: 'color' | 'borderTopColor' = 'color') {
  expect(await elementColor(target, prop), what).toBe(await resolvedColor(target.page(), token))
}

async function seed(request: APIRequestContext, name: string): Promise<string> {
  const testId = await createValidTest(request, {
    name,
    nodes: [
      localFunctionNode(FN_NEW, 'NewInputs', { nodes: [] }),
      localFunctionNode(
        FN_EDIT,
        'EditInputs',
        { nodes: [], inputs: [{ name: 'env', type: 'string', required: false, default: 'local', description: '' }] },
        { x: 300, y: 400 },
      ),
    ],
    edges: [startEdge(FN_NEW), { id: 'e-new-edit', source: FN_NEW, target: FN_EDIT }],
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

async function attach(testInfo: TestInfo, name: string, win: Locator): Promise<void> {
  await testInfo.attach(name, { body: await win.screenshot(), contentType: 'image/png' })
}

/** 560 px wide; the title; the green IN badge right before the close X (VMGR-114). */
async function expectInputFrame(win: Locator, theme: Theme, title: string, closeLabel: string): Promise<void> {
  near((await box(win, 'the input window')).width, 560, 'the input window width')
  await expect(win.getByText(title, { exact: true })).toHaveCSS('font-size', '18px')
  const badge = control(win, 'create-role-badge')
  await expect(badge).toHaveText('IN')
  await colorOf(badge, TEXT_COLOR[theme].IN, 'the IN badge is green')
  const badgeBox = await box(badge, 'the IN badge')
  const closeBox = await box(win.getByRole('button', { name: closeLabel, exact: true }), 'the close X')
  expect(badgeBox.x + badgeBox.width, 'the badge comes before the close X').toBeLessThanOrEqual(closeBox.x)
  expect(closeBox.x - (badgeBox.x + badgeBox.width), 'the badge sits right by the close X').toBeLessThanOrEqual(12)
}

/** Description (80 px, placeholder, resize grip) and the half-width Type select with no Kind. */
async function expectDescriptionAndType(win: Locator): Promise<void> {
  const page = win.page()
  await expect(fieldLabel(win, 'Description')).toHaveCSS('font-size', '16px')
  const description = control(win, 'param-description')
  await expect(description).toHaveAttribute('placeholder', 'What this parameter is for')
  near((await box(description, 'Description')).height, 80, 'the Description height')
  expect(await description.evaluate((el) => getComputedStyle(el).resize), 'Description has a resize grip').not.toBe('none')
  await expect(description).toBeEditable()

  const typeSelect = control(win, 'create-type-select')
  await expect(typeSelect).toContainText('String')
  expect(await elementColor(typeSelect.getByText('Text value', { exact: true }), 'color'), 'the type hint is muted').toBe(
    await resolvedColor(page, 'var(--muted-foreground)'),
  )
  const nameBox = await box(control(win, 'create-variable-name'), 'Name')
  near((await box(typeSelect, 'Type')).width, (nameBox.width - 12) / 2, 'Type is half width')
  await expect(typeSelect).toBeEnabled()
  await expect(control(win, 'create-kind-select'), 'an input has no Kind').toHaveCount(0)
}

/** The four checkbox rows in order, each ticked or not, locked with its italic note or free. */
async function expectCheckboxRows(win: Locator, rows: Record<Box, RowState>): Promise<void> {
  const tops: number[] = []
  for (const name of CHECKBOX_ORDER) {
    const checkbox = windowCheckbox(win, name)
    const state = rows[name]
    await expect(checkbox.locator('xpath=following-sibling::label'), `${name} label`).toHaveText(CHECKBOX_LABELS[name])
    await expect(checkbox, `${name} tick`).toHaveAttribute('data-state', state.ticked ? 'checked' : 'unchecked')
    if (state.note === undefined) {
      await expect(checkbox, `${name} is free`).not.toHaveAttribute('aria-disabled', 'true')
      await expect(checkbox).toBeEnabled()
    } else {
      await expect(checkbox, `${name} is locked`).toHaveAttribute('aria-disabled', 'true')
      await expect(checkbox, `${name} names its lock`).toHaveAccessibleDescription(state.note)
      await expect(checkbox.locator('xpath=..').getByText(state.note, { exact: true })).toHaveCSS('font-style', 'italic')
    }
    tops.push((await box(checkbox, name)).y)
  }
  expect([...tops].sort((a, b) => a - b), 'Required, Mark as secret, Set to null, Create enum').toEqual(tops)
}

/** `Value` with the pill right after it, in its theme color. */
async function expectPill(win: Locator, theme: Theme, text: 'Default' | 'Current'): Promise<void> {
  const pill = valueSwitch(win)
  await expect(pill).toHaveText(text)
  await expect(pill).toHaveCSS('font-size', '12px')
  near((await box(pill, 'the pill')).height, 22, 'the pill height', 0.5)
  await colorOf(pill, TEXT_COLOR[theme][text], `the ${text} pill color`)
  const label = fieldLabel(win, 'Value')
  await expect(label).toBeVisible()
  const labelBox = await box(label, 'the Value label')
  const pillBox = await box(pill, 'the pill')
  expect(pillBox.x, 'the pill comes right after Value').toBeGreaterThan(labelBox.x)
  near(pillBox.y + pillBox.height / 2, labelBox.y + labelBox.height / 2, 'the pill is centered on the label')
}

/** Allowed values: right after Create enum, one line in the list color, with its Open editor button. */
async function expectAllowedValues(win: Locator): Promise<void> {
  expect(await createWindowOrder(win.page(), win)).toEqual([
    'name',
    'description',
    'type',
    'required',
    'secret',
    'set-to-null',
    'create-enum',
    'allowed-values',
    'value',
  ])
  await expect(fieldLabel(win, 'Allowed values')).toHaveCSS('font-size', '16px')
  const line = valueField(win, 'allowed-values').locator('input')
  await expect(line).toHaveValue(ALLOWED)
  await colorOf(line, 'var(--color-amber-300)', 'the allowed values take the list color')
  const button = control(win, 'open-allowed-values-editor-button')
  await expect(button).toHaveAccessibleName('Open editor')
  expect((await box(button, 'Open editor')).x, 'Open editor sits right of the list').toBeGreaterThan(
    (await box(line, 'the list')).x,
  )
}

async function expectFooter(win: Locator, submit: 'Create' | 'Save'): Promise<Locator> {
  const cancel = windowCancelButton(win)
  const save = windowSaveButton(win)
  await expect(cancel).toHaveText('Cancel')
  await expect(save).toHaveText(submit)
  expect((await box(cancel, 'Cancel')).x, 'Cancel comes first').toBeLessThan((await box(save, submit)).x)
  return save
}

async function enumNewFrame(page: Page, theme: Theme, testInfo: TestInfo): Promise<void> {
  const win = await openFunctionCreateModal(page, 'input')
  await setCreateName(page, 'env', win)
  await expectInputFrame(win, theme, 'New input parameter', 'Close create form')
  await expectDescriptionAndType(win)
  await setWindowCheckbox(win, 'create-enum', true)
  await setAllowedValues(win, ALLOWED)
  await setWindowValue(page, win, 'dev')
  await expectCheckboxRows(win, ENUM_ROWS)
  await expectAllowedValues(win)
  await expect(fieldLabel(win, 'Default value')).toHaveCSS('font-size', '16px')
  // FIELD-12: Name, Allowed values and Default value carry the red star while the choice list is on.
  for (const label of ['Name', 'Allowed values', 'Default value']) await expectStar(fieldLabel(win, label), true)
  await expect(valueSwitch(win), 'Add shows no pill').toHaveCount(0)
  await expect(enumTrigger(win)).toHaveText('dev')
  await colorOf(enumTrigger(win).getByText('dev', { exact: true }), 'var(--color-sky-300)', 'dev takes the string color')
  await expect(control(win, 'create-enum-default-error')).toHaveCount(0)
  const create = await expectFooter(win, 'Create')
  await expect(create).toBeEnabled()
  await attach(testInfo, `input-enum-new-${theme}.png`, win)
  await saveWindow(page, win)
  await expect(variableRow(page, 'env'), 'the enum input is created').toBeVisible()
}

async function requiredNewFrame(page: Page, theme: Theme, testInfo: TestInfo): Promise<void> {
  const win = await openFunctionCreateModal(page, 'input')
  await setCreateName(page, 'host', win)
  await setWindowCheckbox(win, 'required', true)
  await expectInputFrame(win, theme, 'New input parameter', 'Close create form')
  await expectDescriptionAndType(win)
  // Per VMGR-113: a Required input may keep a default, so the default stays an editable field.
  await expectCheckboxRows(win, REQUIRED_ROWS)
  await expect(fieldLabel(win, 'Default value')).toBeVisible()
  await expectStar(fieldLabel(win, 'Name'), true)
  await expectStar(fieldLabel(win, 'Default value'), false)
  const field = valueField(win).locator('input')
  await expect(field).toHaveValue('')
  await expect(field).toBeEditable()
  expect(await field.getAttribute('placeholder'), 'the empty default shows no placeholder').toBeFalsy()
  await expect(control(win, 'open-value-editor-button')).toHaveAccessibleName('Open editor')
  await expect(await expectFooter(win, 'Create')).toBeEnabled()
  await attach(testInfo, `input-required-${theme}.png`, win)
  await cancelWindow(page, win, 'Close')
}

async function defaultJustEnumFrame(page: Page, theme: Theme, testInfo: TestInfo): Promise<void> {
  const win = await openEditWindow(page, 'env')
  await expectInputFrame(win, theme, 'Edit input parameter', 'Close edit form')
  await expectPill(win, theme, 'Default')
  await expect(valueField(win).locator('input')).toHaveValue('local')
  await setWindowCheckbox(win, 'create-enum', true)
  await setAllowedValues(win, ALLOWED)
  await expectCheckboxRows(win, ENUM_ROWS)
  await expectAllowedValues(win)
  await expectPill(win, theme, 'Default')
  const trigger = enumTrigger(win)
  await expect(trigger, 'the default is no allowed value, so the select is empty').toHaveText('Select…')
  await colorOf(trigger, 'var(--destructive)', 'the empty select has the red error border', 'borderTopColor')
  const error = control(win, 'create-enum-default-error')
  await expect(error).toHaveText('Default value is required')
  await colorOf(error, 'var(--destructive)', 'the message is red')
  expect((await box(error, 'the message')).y, 'the message sits under the select').toBeGreaterThan(
    (await box(trigger, 'the select')).y,
  )
  const save = await expectFooter(win, 'Save')
  await expect(save, 'Save waits for a default').toBeDisabled()
  await attach(testInfo, `input-default-just-enum-${theme}.png`, win)

  await setWindowValue(page, win, 'dev')
  await expect(error, 'picking an allowed value clears the message').toHaveCount(0)
  await expect(save, 'an allowed default enables Save').toBeEnabled()
  await saveWindow(page, win)
}

async function currentFrame(page: Page, theme: Theme, testInfo: TestInfo): Promise<void> {
  const win = await openEditWindow(page, 'env', { view: 'Current' })
  await expectInputFrame(win, theme, 'Edit input parameter', 'Close edit form')
  await expectPill(win, theme, 'Current')
  await setWindowValue(page, win, 'staging')
  await expect(enumTrigger(win)).toHaveText('staging')
  await colorOf(enumTrigger(win).getByText('staging', { exact: true }), 'var(--color-sky-300)', 'staging takes the string color')
  await expectCheckboxRows(win, ENUM_ROWS)
  await expectAllowedValues(win)
  await expect(control(win, 'create-variable-name')).toBeEditable()
  await expect(control(win, 'param-description')).toBeEditable()
  await expect(control(win, 'create-type-select')).toBeEnabled()
  await expect(control(win, 'create-enum-default-error')).toHaveCount(0)
  await expect(await expectFooter(win, 'Save')).toBeEnabled()
  await attach(testInfo, `input-current-${theme}.png`, win)
  await cancelWindow(page, win, 'Close')
}

test.describe('V-VMGR-WIN-03: the input parameter window', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const) {
    test(`enum New, Default just made an enum, Current and a plain Required input in the ${theme} theme`, async ({
      page,
      request,
    }, testInfo) => {
      const testName = `zz-v-vmgr-window-03-${randomUUID().slice(0, 8)}`
      testId = await seed(request, testName)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)

      await digIn(page, FN_NEW)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      await test.step('New enum input', () => enumNewFrame(page, theme, testInfo))
      await test.step('New plain Required input', () => requiredNewFrame(page, theme, testInfo))

      await popToBreadcrumbSegment(page, testName)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(0)
      await digIn(page, FN_EDIT)
      await expect(breadcrumbFunctionSegments(page)).toHaveCount(1)
      await test.step('Edit, Default just made an enum', () => defaultJustEnumFrame(page, theme, testInfo))
      await test.step('Edit with Current', () => currentFrame(page, theme, testInfo))
    })
  }
})
