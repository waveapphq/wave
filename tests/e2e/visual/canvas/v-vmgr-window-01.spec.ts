/**
 * V-VMGR-WIN-01: the Test variable window - New variable, Edit with Initial, Edit with Current
 * Design Decisions: VMGR-106, VMGR-108, VMGR-109, VMGR-110, VMGR-114, FIELD-12
 * REQ: REQ-3.1.3.11, REQ-3.1.3.24
 *
 * Phase: no-data. Seed (API, POST /tests): one `zz-` Test holding the Map variable `conf` read by one Log
 * Block; each test seeds its own Test, checks it validates with zero errors and deletes it afterwards.
 * One test per theme: the dark project's theme, then the light theme through the shell toggle.
 *
 * Pass Criteria (each frame, in both themes):
 * 1. The window is 410 px wide with a rounded border and a resize corner at its bottom right.
 * 2. The header holds the grip, the 18 px semibold title (`New variable` / `Edit variable`) and the close X at
 *    the right; a variable carries no role badge.
 * 3. The labels Name, Type, Kind and Value are 16 px medium, 6 px above their field; Name ends with the red
 *    star (screen readers hear "required").
 * 4. Name is a 36 px monospace field; Add shows the placeholder `variable_name` and `Name is required` from
 *    the moment it opens until a name is typed, and again once the name is emptied.
 * 5. Type and Kind share one row in two equal columns 12 px apart; Type reads `Map` with the muted
 *    `Key-value pairs`, Kind reads `Literal`.
 * 6. `Mark as secret (value will be masked)` sits above `Set to null`, both 14 px labels, both enabled.
 * 7. Add: `Value` with no pill; the one-line monospace value `{}` in the map color; the icon-only, borderless
 *    32 x 32 Open editor button right of it; Cancel then Create, Create disabled while Name is empty and
 *    enabled once a name is typed.
 * 8. Edit with Initial: the 22 px, 12 px semibold pill right after `Value` and centered on it reads `Initial`
 *    in indigo with its chevron; the value is the saved map on one line, cut with "…"; Cancel then Save, Save
 *    enabled with no change.
 * 9. Edit with Current (a Current value staged before any run): the pill reads `Current` in amber and the field
 *    shows the staged map while Initial keeps the saved one; Name, Type, Kind and both checkboxes are enabled as
 *    on Initial, and Save is enabled.
 * 10. A screenshot of each frame in each theme is attached.
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
import { createValidTest, logNode, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import { toggleTheme } from '../../helpers/theme'
import {
  cancelWindow,
  openCreateModal,
  openEditWindow,
  saveWindow,
  setCreateName,
  setCreateType,
  setValueView,
  setWindowValue,
  valueField,
  valueSwitch,
  windowCancelButton,
  windowCheckbox,
  windowSaveButton,
} from '../../helpers/variable-create'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'

const CONF = { host: 'db.internal', port: 5432, user: 'wave' }
const CONF_LINE = '{"host": "db.internal", "port": 5432, "user": "wave"}'
const STAGED_LINE = '{"host": "db.internal", "port": 6543, "user": "wave"}'

/** The pill's text color per theme (indigo Initial, amber Current). */
const PILL_TEXT: Record<Theme, Record<'Initial' | 'Current', string>> = {
  dark: { Initial: 'var(--color-indigo-300)', Current: 'var(--color-amber-300)' },
  light: { Initial: 'var(--color-indigo-700)', Current: 'var(--color-amber-700)' },
}

const control = (modal: Locator, id: string): Locator => modal.locator(`[data-testid="${id}"]`)
// A required label ends with the red star and its screen-reader word (FIELD-12).
const fieldLabel = (modal: Locator, text: string): Locator =>
  modal.locator('label').filter({ hasText: new RegExp(`^${text}(\\* required)?$`) })

/** FIELD-12: the label ends with the red star, which screen readers hear as "required". */
async function expectRequiredStar(label: Locator): Promise<void> {
  const star = label.locator('span[aria-hidden="true"]')
  await expect(star).toHaveText('*')
  expect(await elementColor(star, 'color'), 'the star is red').toBe(await resolvedColor(label.page(), 'var(--destructive)'))
  await expect(label.locator('.sr-only')).toHaveText(' required')
}
const lineInput = (modal: Locator): Locator => valueField(modal).locator('input')

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

async function seed(request: APIRequestContext): Promise<string> {
  const testId = await createValidTest(request, {
    name: `zz-v-vmgr-window-01-${randomUUID().slice(0, 8)}`,
    nodes: [logNode('log-conf', 'Log conf', 'str(conf)')],
    edges: [startEdge('log-conf')],
    variables: { conf: { value: CONF, type: 'map', scope: 'test' } },
  })
  const validation = await validateTest(request, testId)
  expect(validation.errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

async function attach(testInfo: TestInfo, name: string, modal: Locator): Promise<void> {
  await testInfo.attach(name, { body: await modal.screenshot(), contentType: 'image/png' })
}

/** The window frame: 410 px, rounded and bordered, resize corner bottom right (VMGR-106). */
async function expectFrame(modal: Locator): Promise<void> {
  const frame = await box(modal, 'the window')
  near(frame.width, 410, 'the variable window width')
  const look = await modal.evaluate((el) => {
    const style = getComputedStyle(el)
    return { radius: Number.parseFloat(style.borderTopLeftRadius), border: Number.parseFloat(style.borderTopWidth) }
  })
  expect(look.radius, 'the window has rounded corners').toBeGreaterThan(0)
  expect(look.border, 'the window has a border').toBeGreaterThanOrEqual(1)
  const corner = await box(control(modal, 'dialog-resize-corner'), 'the resize corner')
  expect(frame.x + frame.width - (corner.x + corner.width), 'the corner sits at the right edge').toBeLessThanOrEqual(4)
  expect(frame.y + frame.height - (corner.y + corner.height), 'the corner sits at the bottom edge').toBeLessThanOrEqual(4)
}

/** Grip, 18 px semibold title, close X at the right, no role badge (VMGR-114). */
async function expectHeader(modal: Locator, title: string, closeLabel: string): Promise<void> {
  const titleText = modal.getByText(title, { exact: true })
  await expect(titleText).toHaveCSS('font-size', '18px')
  await expect(titleText).toHaveCSS('font-weight', '600')
  const titleBox = await box(titleText, 'the title')
  const grip = await box(modal.locator('svg.lucide-grip-vertical').first(), 'the grip')
  expect(grip.x + grip.width, 'the grip leads the title').toBeLessThanOrEqual(titleBox.x)
  const close = modal.getByRole('button', { name: closeLabel, exact: true })
  const closeBox = await box(close, 'the close X')
  const frame = await box(modal, 'the window')
  expect(closeBox.x, 'the close X sits right of the title').toBeGreaterThan(titleBox.x + titleBox.width)
  expect(frame.x + frame.width - (closeBox.x + closeBox.width), 'the close X sits at the right').toBeLessThanOrEqual(24)
  await expect(control(modal, 'create-role-badge'), 'a variable carries no badge').toHaveCount(0)
}

/** Each label is 16 px medium and sits 6 px above its field (I-O). */
async function expectLabels(modal: Locator, valueLine: Locator): Promise<void> {
  const fields: Array<[string, Locator]> = [
    ['Name', control(modal, 'create-variable-name')],
    ['Type', control(modal, 'create-type-select')],
    ['Kind', control(modal, 'create-kind-select')],
    ['Value', valueField(modal)],
  ]
  for (const [text, field] of fields) {
    const label = fieldLabel(modal, text)
    await expect(label, `${text} label size`).toHaveCSS('font-size', '16px')
    await expect(label, `${text} label weight`).toHaveCSS('font-weight', '500')
    const above = text === 'Value' ? valueLine : label
    const labelBox = await box(above, `${text} label`)
    const fieldBox = await box(field, `${text} field`)
    near(fieldBox.y - (labelBox.y + labelBox.height), 6, `${text}: 6 px between label and field`)
  }
}

/** Name 36 px mono; Type + Kind two equal columns 12 px apart; the checkboxes in order at 14 px. */
async function expectFields(modal: Locator, name: string): Promise<void> {
  const nameField = control(modal, 'create-variable-name')
  near((await box(nameField, 'Name')).height, 36, 'Name height')
  expect(await nameField.evaluate((el) => getComputedStyle(el).fontFamily), 'Name is monospace').toMatch(/mono/i)
  await expect(nameField).toHaveValue(name)
  await expect(nameField).toBeEditable()

  const typeSelect = control(modal, 'create-type-select')
  const kindSelect = control(modal, 'create-kind-select')
  const typeBox = await box(typeSelect, 'Type')
  const kindBox = await box(kindSelect, 'Kind')
  near(kindBox.width, typeBox.width, 'Type and Kind are equal columns')
  near(kindBox.y, typeBox.y, 'Kind sits beside Type')
  near(kindBox.x - (typeBox.x + typeBox.width), 12, 'the 12 px column gap')
  await expect(typeSelect).toContainText('Map')
  const hint = typeSelect.getByText('Key-value pairs', { exact: true })
  expect(await elementColor(hint, 'color'), 'the type hint is muted').toBe(
    await resolvedColor(modal.page(), 'var(--muted-foreground)'),
  )
  await expect(kindSelect).toHaveText('Literal')
  await expect(typeSelect).toBeEnabled()
  await expect(kindSelect).toBeEnabled()

  const secret = windowCheckbox(modal, 'secret')
  const setNull = windowCheckbox(modal, 'set-to-null')
  const rows: Array<[Locator, string]> = [
    [secret, 'Mark as secret (value will be masked)'],
    [setNull, 'Set to null'],
  ]
  for (const [checkbox, text] of rows) {
    const label = checkbox.locator('xpath=following-sibling::label')
    await expect(label).toHaveText(text)
    await expect(label).toHaveCSS('font-size', '14px')
    await expect(checkbox).toHaveAttribute('data-state', 'unchecked')
    await expect(checkbox).toBeEnabled()
    await expect(checkbox).not.toHaveAttribute('aria-disabled', 'true')
  }
  expect((await box(secret, 'Mark as secret')).y, 'Mark as secret comes first').toBeLessThan(
    (await box(setNull, 'Set to null')).y,
  )
}

/** The one-line mono value, its color, and the icon-only 32 x 32 borderless Open editor button right of it. */
async function expectValueLine(modal: Locator, text: string): Promise<void> {
  const page = modal.page()
  const input = lineInput(modal)
  await expect(input).toHaveValue(text)
  near((await box(input, 'the value field')).height, 36, 'the value field height')
  expect(await input.evaluate((el) => getComputedStyle(el).fontFamily), 'the value is monospace').toMatch(/mono/i)
  expect(await elementColor(input, 'color'), 'the value takes the map color').toBe(
    await resolvedColor(page, 'var(--color-emerald-400)'),
  )
  const button = control(modal, 'open-value-editor-button')
  await expect(button).toHaveAccessibleName('Open editor')
  await expect(button).toHaveText('')
  await expect(button.locator('svg')).toHaveCount(1)
  const buttonBox = await box(button, 'Open editor')
  near(buttonBox.width, 32, 'Open editor width')
  near(buttonBox.height, 32, 'Open editor height')
  const inputBox = await box(input, 'the value field')
  expect(buttonBox.x, 'Open editor sits right of the field').toBeGreaterThanOrEqual(inputBox.x + inputBox.width)
  near(buttonBox.y + buttonBox.height / 2, inputBox.y + inputBox.height / 2, 'Open editor is centered on the field')
  const border = await button.evaluate((el) => {
    const style = getComputedStyle(el)
    return { width: Number.parseFloat(style.borderTopWidth), color: style.borderTopColor }
  })
  expect(border.width === 0 || /rgba\(.*,\s*0\)$|transparent/.test(border.color), 'Open editor has no border').toBe(true)
}

/** A value wider than its field is cut with "…" at the field's end. */
async function expectCut(input: Locator): Promise<void> {
  const cut = await input.evaluate((el) => ({
    overflow: getComputedStyle(el).textOverflow,
    wider: el.scrollWidth > el.clientWidth,
  }))
  expect(cut, 'the long value is cut with "…"').toEqual({ overflow: 'ellipsis', wider: true })
}

/** The 22 px, 12 px semibold pill right after `Value`, centered on it, with its chevron and theme color. */
async function expectPill(modal: Locator, theme: Theme, text: 'Initial' | 'Current'): Promise<void> {
  const page = modal.page()
  const pill = valueSwitch(modal)
  await expect(pill).toHaveText(text)
  await expect(pill).toHaveCSS('font-size', '12px')
  await expect(pill).toHaveCSS('font-weight', '600')
  await expect(pill.locator('[data-testid="mode-pill-chevron"]')).toHaveCount(1)
  const pillBox = await box(pill, 'the pill')
  near(pillBox.height, 22, 'the pill height', 0.5)
  const label = await box(fieldLabel(modal, 'Value'), 'the Value label')
  const labelText = await fieldLabel(modal, 'Value').evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    return range.getBoundingClientRect().right
  })
  near(pillBox.x - labelText, 8, 'the pill sits right after the label', 1.5)
  near(pillBox.y + pillBox.height / 2, label.y + label.height / 2, 'the pill is centered on the label')
  expect(await elementColor(pill, 'color'), `${text} pill color`).toBe(await resolvedColor(page, PILL_TEXT[theme][text]))
}

async function expectFooter(modal: Locator, submit: 'Create' | 'Save'): Promise<Locator> {
  const cancel = windowCancelButton(modal)
  const save = windowSaveButton(modal)
  await expect(cancel).toHaveText('Cancel')
  await expect(save).toHaveText(submit)
  expect((await box(cancel, 'Cancel')).x, 'Cancel comes first').toBeLessThan((await box(save, submit)).x)
  return save
}

/** Stage a Current value before any run: pencil, pill Current, the map typed on one line, Save. */
async function stageCurrent(page: Page): Promise<void> {
  const win = await openEditWindow(page, 'conf', { view: 'Current' })
  await setWindowValue(page, win, STAGED_LINE)
  await saveWindow(page, win)
}

async function newVariableFrame(page: Page, theme: Theme, testInfo: TestInfo): Promise<void> {
  const modal = await openCreateModal(page)
  await setCreateType(page, 'map', modal)
  await expectFrame(modal)
  await expectHeader(modal, 'New variable', 'Close create form')
  await expect(control(modal, 'create-variable-name')).toHaveAttribute('placeholder', 'variable_name')
  // FIELD-12: Name carries the red star, and its error shows as the window opens.
  await expectRequiredStar(fieldLabel(modal, 'Name'))
  await expect(control(modal, 'create-name-error')).toHaveText('Name is required')
  await expectFields(modal, '')
  await expectLabels(modal, fieldLabel(modal, 'Value'))
  await expect(valueSwitch(modal), 'Add shows no pill').toHaveCount(0)
  await expectValueLine(modal, '{}')
  const create = await expectFooter(modal, 'Create')
  await expect(create, 'Create waits for a name').toBeDisabled()
  await attach(testInfo, `new-variable-${theme}.png`, modal)
  await setCreateName(page, 'conf_two', modal)
  await expect(create, 'a name enables Create').toBeEnabled()
  await expect(control(modal, 'create-name-error'), 'a name takes the error away').toHaveCount(0)
  await setCreateName(page, '', modal)
  await expect(create, 'an emptied name disables Create again').toBeDisabled()
  await expect(control(modal, 'create-name-error')).toHaveText('Name is required')
  await cancelWindow(page, modal, 'Close')
}

async function editFrames(page: Page, theme: Theme, testInfo: TestInfo): Promise<void> {
  const modal = await openEditWindow(page, 'conf')
  await expectFrame(modal)
  await expectHeader(modal, 'Edit variable', 'Close edit form')
  await expectRequiredStar(fieldLabel(modal, 'Name'))
  await expect(control(modal, 'create-name-error'), 'a named variable shows no Name error').toHaveCount(0)
  await expectFields(modal, 'conf')
  const valueLine = valueSwitch(modal).locator('xpath=..')
  await expectLabels(modal, valueLine)
  await expectPill(modal, theme, 'Initial')
  await expectValueLine(modal, CONF_LINE)
  await expectCut(lineInput(modal))
  await expect(await expectFooter(modal, 'Save'), 'Save is enabled with no change').toBeEnabled()
  await attach(testInfo, `edit-initial-${theme}.png`, modal)

  await setValueView(page, modal, 'Current')
  await expectPill(modal, theme, 'Current')
  await expectValueLine(modal, STAGED_LINE)
  await expectCut(lineInput(modal))
  // Per VMGR-108: the Current view keeps the definition editable, as on Initial.
  await expectFields(modal, 'conf')
  await expect(windowSaveButton(modal), 'Save is enabled on Current').toBeEnabled()
  await attach(testInfo, `edit-current-${theme}.png`, modal)
  await cancelWindow(page, modal)
}

test.describe('V-VMGR-WIN-01: the Test variable window', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session/`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const) {
    test(`New variable, Edit with Initial and Edit with Current in the ${theme} theme`, async ({
      page,
      request,
    }, testInfo) => {
      testId = await seed(request)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      await stageCurrent(page)

      await test.step('New variable (Map)', () => newVariableFrame(page, theme, testInfo))
      await test.step('Edit with Initial, then Current', () => editFrames(page, theme, testInfo))
    })
  }
})
