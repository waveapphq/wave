/**
 * V-VMGR-CREATE-03: the input and output parameter windows and their default rules
 * Design Decisions: VMGR-97, VMGR-98, VMGR-100, VMGR-103, VMGR-104, VMGR-112, VMGR-113, FIELD-10, FIELD-12
 * REQ: REQ-3.1.2.1, REQ-3.1.2.10, REQ-3.1.2.11, REQ-3.1.3.24
 *
 * Phase: no-data. Seed (API): one `zz-` Test holding one empty Local Function (`createValidTest`);
 * every window is opened and filled through the in-Function "+ Add" menu.
 *
 * Pass Criteria:
 * 1. An input window reads Name, Description, Type (half width, no Kind), Required, Mark as secret, Set to
 *    null, Create enum (String, Integer, Float only), then the value captioned `Default value`; an Array
 *    default is one line whose "Edit value" grid has its Type column and the Visual view; enum on adds
 *    Allowed values right under Create enum and turns the default into a select captioned `Default value` with
 *    the red star (FIELD-12).
 * 2. An output window puts Type and Kind on one row and captions the value `Value`; Kind Expression shows
 *    the expression field; ticked Set to null hides Kind, halves Type and shows one `null` field.
 * 3. The enum Allowed values grid has `#`, `Value` and `Type` columns, each item's Type a read-only pill of
 *    the input Type (no chevron, not a picker), and its items take the input Type's color; an ordinary
 *    list's grid has the Type column with its picker.
 * 4. Mark as secret (Array) forces Set to null: the box reads ticked with `aria-disabled="true"` and no
 *    `disabled` attribute; a click on the box or its label, Space and Enter leave it ticked; the default is a
 *    read-only `null` input with `aria-disabled="true"`.
 * 5. The forced row's tooltip (exact VMGR-103 text) opens to the right of the label when the row is hovered
 *    and when Tab reaches the box; the null field's tooltip (hover and Tab) and the row's never cover the
 *    "Set to null" or "Default value" label and ends inside the window, the row's on at most two lines;
 *    on keyboard focus the row draws one 2 px indigo ring around box and label, with room inside it, at
 *    full opacity, and the box draws none; locking the row moves nothing; Required plus secret shows the
 *    secret text (VMGR-103).
 * 6. Required holds Set to null off with "off while Required is set" and keeps an editable default field
 *    (VMGR-113); locking the row moves nothing; unticking Required frees the row.
 * 7. Create enum and Mark as secret exclude each other with the hints "off while enum is set",
 *    "locked on while enum is set" and "off while secret is set"; under enum Set to null is off and locked
 *    with "off while enum is set".
 * 8. A screenshot of each wireframe state is attached.
 */

import {
  test,
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
  type TestInfo,
} from '../../helpers/playwright-fixtures'
import { leaveExpressionEditor } from '../../helpers/code-editor'
import { BACKEND_URL } from '../../helpers/config'
import { createValidTest, localFunctionNode, openTest, startEdge } from '../../helpers/fn-seed'
import { resolvedColor } from '../../helpers/config-sheet'
import { digIn } from '../../helpers/workbench'
import {
  cancelCreate,
  closeValueEditor,
  createWindowOrder,
  insertCodeValue,
  openFunctionCreateModal,
  openValueEditor,
  setAllowedValues,
  setCreateKind,
  setCreateName,
  setCreateType,
  setToNull,
  setWindowCheckbox,
  setWindowValue,
  valueField,
  writeValueEditor,
} from '../../helpers/variable-create'
import { randomUUID } from 'node:crypto'

const FN_ID = 'fn-create-03'
const TOOLTIP = '[data-slot="tooltip-content"]'
// Tailwind indigo-500, the focus ring color of every create-window control.
const INDIGO_500 = 'oklch(58.5% 0.233 277.117)'

const SECRET_REASON = 'A secret input has no default: the Function Block gives the value.'

const INPUT_DEFAULT_LABEL = 'Default value'
const OUTPUT_DEFAULT_LABEL = 'Value'

let testId = ''

async function seedAndDigIn(page: Page, request: APIRequestContext): Promise<void> {
  testId = await createValidTest(request, {
    name: `zz-vmgr-create-03-${randomUUID().slice(0, 8)}`,
    nodes: [localFunctionNode(FN_ID, 'Create03_Fn', { nodes: [] })],
    edges: [startEdge(FN_ID)],
  })
  await openTest(page, testId)
  await digIn(page, FN_ID)
  await expect(page.getByTestId('add-variable-dropdown-trigger')).toBeVisible()
}

const control = (modal: Locator, testId: string): Locator => modal.locator(`[data-testid="${testId}"]`)

/** The label a create-window checkbox carries (its next sibling). */
const labelOf = (box: Locator): Locator => box.locator('xpath=following-sibling::label')

/** The row a create-window checkbox sits in: the tooltip trigger and the focus-ring holder. */
const rowOf = (box: Locator): Locator => box.locator('xpath=..')

/** The italic note a locked checkbox row shows beside its label. */
const noteOf = (box: Locator): Locator => rowOf(box).locator('span.italic')

const valueLabel = (modal: Locator): Locator =>
  control(modal, 'create-value-area').locator('label').first()

/** The visible column labels of the "Edit value" window's list grid (a fixed type's unseen sizer pill left out). */
async function listHeader(sheet: Locator): Promise<string[]> {
  const texts = await control(sheet, 'array-edit-body')
    .locator('div.sticky > span')
    .evaluateAll((cells) =>
      cells.map((cell) => {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT)
        let text = ''
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (getComputedStyle(node.parentElement as Element).visibility !== 'hidden') text += node.textContent ?? ''
        }
        return text
      }),
    )
  return texts.map((text) => text.trim()).filter((text) => text !== '')
}

/** FIELD-12: the Default value caption of an enum input ends with the red star. */
async function expectStarredDefault(modal: Locator): Promise<void> {
  await expect(valueLabel(modal)).toHaveText(`${INPUT_DEFAULT_LABEL}* required`)
  await expect(valueLabel(modal).locator('span[aria-hidden="true"]')).toHaveClass(/\btext-destructive\b/)
}

/** The fixed item type of each listed item: a read-only pill, no picker (FIELD-10). */
async function expectFixedTypePills(sheet: Locator, count: number, type: string): Promise<void> {
  for (let index = 0; index < count; index++) {
    const pill = control(sheet, `array-type-${index}`)
    await expect(pill, `item ${index} type`).toHaveText(type)
    await expect(pill, 'a read-only pill, not a picker').not.toHaveAttribute('role', 'combobox')
    await expect(pill.locator('svg.lucide-chevron-down'), 'no chevron').toHaveCount(0)
  }
}

async function attach(testInfo: TestInfo, name: string, modal: Locator): Promise<void> {
  await testInfo.attach(name, { body: await modal.screenshot(), contentType: 'image/png' })
}

/** The Type select spans about half the form (its column of a two-column row). */
async function expectTypeHalfWidth(modal: Locator): Promise<void> {
  const typeBox = (await control(modal, 'create-type-select').boundingBox())!
  const nameBox = (await control(modal, 'create-variable-name').boundingBox())!
  expect(typeBox.width, 'Type takes half the row').toBeLessThan(nameBox.width * 0.55)
}

/** The drawn ring layers of an element's box-shadow: color as sRGB hex and spread in px. */
async function ringLayers(page: Page, target: Locator): Promise<Array<{ color: string; spread: number }>> {
  const layers = await target.evaluate((el) => {
    const shadow = getComputedStyle(el).boxShadow
    if (!shadow || shadow === 'none') return []
    return shadow
      .split(/,(?![^(]*\))/)
      .map((layer) => layer.trim())
      .map((layer) => {
        const color =
          (layer.match(/^(?:inset )?((?:rgba?|oklch|oklab|color|lab|lch|hsla?)\([^)]*\)|#[0-9a-f]+)/i) ?? [])[1] ?? ''
        const lengths = layer.replace(color, '').match(/-?[\d.]+px/g) ?? []
        return { color, spread: Number.parseFloat(lengths[3] ?? '0') }
      })
      .filter((ring) => ring.spread > 0 && !/,\s*0\)$/.test(ring.color) && !/\/\s*0\)$/.test(ring.color))
  })
  const resolved: Array<{ color: string; spread: number }> = []
  for (const layer of layers) resolved.push({ color: await resolvedColor(page, layer.color), spread: layer.spread })
  return resolved
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** The box of an element's text alone (a label block can be wider than its words). */
function textBox(target: Locator): Promise<Rect> {
  return target.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rect = range.getBoundingClientRect()
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  })
}

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Exactly one tooltip is open, reads `text`, and covers no label around the forced row. */
async function expectTooltipClear(page: Page, modal: Locator, text: string): Promise<Locator> {
  const tip = page.locator(TOOLTIP)
  await expect(tip).toHaveCount(1)
  // The content holds the text twice (shown, and the hidden role="tooltip" copy); read the accessible one.
  await expect(page.getByRole('tooltip')).toHaveText(text)
  const tipBox = (await tip.boundingBox())!
  const labels: Array<[string, Locator]> = [
    ['Mark as secret', labelOf(control(modal, 'create-secret-checkbox'))],
    ['Set to null', labelOf(control(modal, 'create-set-to-null-checkbox'))],
    ['Default value', valueLabel(modal)],
  ]
  for (const [name, label] of labels) {
    expect(overlaps(tipBox, await textBox(label)), `the tooltip leaves the "${name}" label readable`).toBe(false)
  }
  // The form's 16 px side padding stays clear: the tooltip ends inside the window frame.
  const frame = (await modal.boundingBox())!
  expect(tipBox.x, 'the tooltip starts inside the window').toBeGreaterThanOrEqual(frame.x + 16)
  expect(tipBox.x + tipBox.width, 'the tooltip ends inside the window').toBeLessThanOrEqual(frame.x + frame.width - 16)
  return tip
}

/** The row's tooltip opens to the right of the "Set to null" label, clear of both labels. */
async function expectTooltipRightOf(page: Page, modal: Locator, label: Locator, text: string): Promise<void> {
  const tip = await expectTooltipClear(page, modal, text)
  await expect(tip).toHaveAttribute('data-side', 'right')
  const tipBox = (await tip.boundingBox())!
  // Two text lines (16 px each) plus padding and border: a longer box would wrap onto the labels below.
  expect(tipBox.height, 'the reason stays on at most two lines').toBeLessThanOrEqual(46)
  const labelBox = (await label.boundingBox())!
  expect(tipBox.x, 'the tooltip opens to the right of the label').toBeGreaterThanOrEqual(
    labelBox.x + labelBox.width,
  )
}

/** Where the Set to null box and its label sit in the window (a lock may resize the window), so a lock is seen to move nothing. */
async function nullRowParts(modal: Locator): Promise<Rect[]> {
  const box = control(modal, 'create-set-to-null-checkbox')
  const origin = (await modal.boundingBox())!
  return [(await box.boundingBox())!, (await labelOf(box).boundingBox())!].map((rect) => ({
    ...rect,
    x: rect.x - origin.x,
    y: rect.y - origin.y,
  }))
}

function expectSamePlace(after: Rect[], before: Rect[], what: string): void {
  for (const [index, rect] of after.entries()) {
    expect(Math.abs(rect.x - before[index].x), `${what}: nothing moved (x)`).toBeLessThanOrEqual(0.5)
    expect(Math.abs(rect.y - before[index].y), `${what}: nothing moved (y)`).toBeLessThanOrEqual(0.5)
  }
}

async function moveAway(page: Page): Promise<void> {
  await page.mouse.move(2, 2)
  await expect(page.locator(TOOLTIP)).toHaveCount(0)
}

/** The forced Set to null row: ticked, aria-disabled, never natively disabled; the default a read-only null input. */
async function expectForcedNull(modal: Locator): Promise<void> {
  const box = control(modal, 'create-set-to-null-checkbox')
  await expect(box).toHaveAttribute('data-state', 'checked')
  await expect(box).toHaveAttribute('aria-disabled', 'true')
  await expect(box).not.toHaveAttribute('disabled', /.*/)
  await expect(labelOf(box)).toHaveCSS('opacity', '0.5')
  const field = control(modal, 'create-null-field')
  await expect(field).toHaveJSProperty('tagName', 'INPUT')
  await expect(field).toHaveAttribute('readonly', '')
  await expect(field).toHaveAttribute('aria-disabled', 'true')
  await expect(field).toHaveValue('null')
  await expect(valueLabel(modal)).toHaveText(INPUT_DEFAULT_LABEL)
}

/** Required holds Set to null off with its note; the default stays an editable field (VMGR-113). */
async function expectHeldOffByRequired(modal: Locator): Promise<void> {
  const box = control(modal, 'create-set-to-null-checkbox')
  await expect(box).toHaveAttribute('data-state', 'unchecked')
  await expect(box).toHaveAttribute('aria-disabled', 'true')
  await expect(box).not.toHaveAttribute('disabled', /.*/)
  await expect(box).toHaveAccessibleDescription('off while Required is set')
  await expect(noteOf(box)).toHaveText('off while Required is set')
  await box.click({ force: true })
  await expect(box, 'a click leaves the held box unticked').toHaveAttribute('data-state', 'unchecked')
  await expect(control(modal, 'create-null-field')).toHaveCount(0)
  await expect(valueLabel(modal)).toHaveText(INPUT_DEFAULT_LABEL)
  const field = valueField(modal).locator('input')
  await expect(field).toBeEditable()
  await field.fill('db.internal')
  await expect(field, 'a Required input keeps a default').toHaveValue('db.internal')
}

/** A click on the box or its label, Space and Enter all leave the forced box ticked (VMGR-103). */
async function expectStaysTicked(page: Page, modal: Locator): Promise<void> {
  const box = control(modal, 'create-set-to-null-checkbox')
  await box.click({ force: true })
  await expect(box, 'a click leaves the forced box ticked').toHaveAttribute('data-state', 'checked')
  await labelOf(box).click({ force: true })
  await expect(box, 'a label click leaves it ticked').toHaveAttribute('data-state', 'checked')
  await box.focus()
  await page.keyboard.press('Space')
  await expect(box, 'Space leaves it ticked').toHaveAttribute('data-state', 'checked')
  await page.keyboard.press('Enter')
  await expect(box, 'Enter leaves it ticked').toHaveAttribute('data-state', 'checked')
  await expect(control(modal, 'create-null-field')).toHaveValue('null')
  await control(modal, 'create-null-field').click({ force: true })
  await expect(control(modal, 'create-null-field'), 'a click never focuses the forced field').not.toBeFocused()
  // Focus leaves the row, so its focus-opened tooltip closes before the next check.
  await control(modal, 'create-variable-name').focus()
}

/** Press Tab from the focused control until `target` holds focus (at most `max` presses). */
async function tabTo(page: Page, target: Locator, max = 4): Promise<void> {
  const focused = () => target.evaluate((el) => el === document.activeElement)
  for (let presses = 0; presses < max && !(await focused()); presses++) await page.keyboard.press('Tab')
  await expect(target).toBeFocused()
}

/** Hover the row, then Tab onto the box from `from`: the tooltip and the 2 px indigo ring around box and label. */
async function expectReasonAndRing(page: Page, modal: Locator, from: string, reason: string): Promise<void> {
  const box = control(modal, 'create-set-to-null-checkbox')
  const label = labelOf(box)
  const row = rowOf(box)
  await moveAway(page)

  await label.hover()
  await expectTooltipRightOf(page, modal, label, reason)
  await moveAway(page)

  await control(modal, from).focus()
  await tabTo(page, box)
  await expect(box).toHaveAttribute('data-state', 'checked')
  expect(await box.evaluate((el) => el.matches(':focus-visible')), 'Tab gives the box keyboard focus').toBe(true)
  await expectTooltipRightOf(page, modal, label, reason)

  const indigo = await resolvedColor(page, INDIGO_500)
  const rowRings = await ringLayers(page, row)
  expect(rowRings, 'the row draws one 2 px indigo ring').toEqual([{ color: indigo, spread: 2 }])
  expect(await ringLayers(page, box), 'the dimmed box draws no ring of its own').toEqual([])
  await expect(row, 'the ring is drawn at full opacity').toHaveCSS('opacity', '1')
  const rowBox = (await row.boundingBox())!
  const boxBox = (await box.boundingBox())!
  const labelBox = (await label.boundingBox())!
  const left = boxBox.x
  const right = labelBox.x + labelBox.width
  const top = Math.min(boxBox.y, labelBox.y)
  const bottom = Math.max(boxBox.y + boxBox.height, labelBox.y + labelBox.height)
  // The ring goes around box and label with room inside it on every side.
  expect(left - rowBox.x, 'room between the ring and the box').toBeGreaterThanOrEqual(3)
  expect(rowBox.x + rowBox.width - right, 'room between the label and the ring').toBeGreaterThanOrEqual(3)
  expect(top - rowBox.y, 'room above box and label').toBeGreaterThanOrEqual(3)
  expect(rowBox.y + rowBox.height - bottom, 'room below box and label').toBeGreaterThanOrEqual(3)

  // Tab moves on to the read-only null field; its own reason opens clear of both labels too.
  const field = control(modal, 'create-null-field')
  await tabTo(page, field)
  await expectTooltipClear(page, modal, reason)
  await control(modal, 'create-variable-name').focus()
  await moveAway(page)
  await field.hover()
  await expectTooltipClear(page, modal, reason)
  await moveAway(page)
}

test.describe('V-VMGR-CREATE-03: parameter windows and their default rules', () => {
  test.afterEach(async ({ request }) => {
    await request.delete(`${BACKEND_URL}/workbench/session`).catch(() => undefined)
    if (testId) await request.delete(`${BACKEND_URL}/tests/${testId}`).catch(() => undefined)
    testId = ''
  })

  test('the parameter windows follow the VMGR-98 order', async ({ page, request }, testInfo) => {
    await seedAndDigIn(page, request)

    await test.step('input, Array: one-line default whose "Edit value" grid has its Type column', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await expect(control(modal, 'create-role-badge')).toHaveText('IN')
      await expect(modal).toContainText('New input parameter')
      await setCreateType(page, 'array', modal)
      expect(await createWindowOrder(page, modal)).toEqual([
        'name',
        'description',
        'type',
        'required',
        'secret',
        'set-to-null',
        'value',
      ])
      await expect(control(modal, 'create-kind-select')).toHaveCount(0)
      await expect(control(modal, 'param-create-enum-checkbox'), 'an Array input has no Create enum').toHaveCount(0)
      await expectTypeHalfWidth(modal)
      for (const id of ['param-required-checkbox', 'create-secret-checkbox', 'create-set-to-null-checkbox']) {
        await expect(control(modal, id)).toHaveAttribute('data-state', 'unchecked')
        await expect(control(modal, id)).not.toHaveAttribute('aria-disabled', 'true')
      }
      await expect(valueLabel(modal)).toHaveText(INPUT_DEFAULT_LABEL)
      await writeValueEditor(page, modal, '["alpha", "beta", "gamma"]')
      await expect(valueField(modal).locator('input')).toHaveValue('["alpha", "beta", "gamma"]')
      const sheet = await openValueEditor(page, modal)
      expect(await listHeader(sheet)).toEqual(['#', 'Value', 'Type'])
      for (const index of [0, 1, 2]) await expect(control(sheet, `array-type-${index}`)).toHaveText('string')
      await expect(control(sheet, 'view-dropdown')).toHaveText('Visual')
      await attach(testInfo, 'input-array-default.png', modal)
      await closeValueEditor(page, sheet)
      await cancelCreate(page, modal)
    })

    await test.step('input, String, enum on: Allowed values right under Create enum, then the default select', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await setWindowCheckbox(modal, 'create-enum', true)
      await setAllowedValues(modal, '["alpha", "beta", "gamma"]')
      expect(await createWindowOrder(page, modal)).toEqual([
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
      const required = control(modal, 'param-required-checkbox')
      await expect(required).toHaveAttribute('data-state', 'checked')
      await expect(required).toHaveAttribute('aria-disabled', 'true')
      await expect(noteOf(required)).toHaveText('locked on while enum is set')
      await expect(control(modal, 'param-create-enum-checkbox')).toHaveAttribute('data-state', 'checked')
      const setNull = control(modal, 'create-set-to-null-checkbox')
      await expect(setNull).toHaveAttribute('data-state', 'unchecked')
      await expect(setNull).toHaveAttribute('aria-disabled', 'true')
      await expect(noteOf(setNull)).toHaveText('off while enum is set')
      await expectStarredDefault(modal)
      await expect(control(modal, 'enum-value-select')).toBeVisible()
      const sheet = await openValueEditor(page, modal, 'allowed-values')
      expect(await listHeader(sheet)).toEqual(['#', 'Value', 'Type'])
      await expectFixedTypePills(sheet, 3, 'string')
      await expect(control(sheet, 'view-dropdown')).toHaveText('Visual')
      await attach(testInfo, 'input-string-enum-on.png', modal)
      await closeValueEditor(page, sheet)
      await cancelCreate(page, modal)
    })

    await test.step('output, Integer, Kind Expression: Type and Kind on one row', async () => {
      const modal = await openFunctionCreateModal(page, 'output')
      await expect(control(modal, 'create-role-badge')).toHaveText('OUT')
      await expect(modal).toContainText('New output parameter')
      await setCreateType(page, 'integer', modal)
      await setCreateKind(page, 'Expression', modal)
      await insertCodeValue(page, 'len(rows)', modal)
      await leaveExpressionEditor(modal)
      expect(await createWindowOrder(page, modal)).toEqual([
        'name',
        'description',
        'type+kind',
        'secret',
        'value',
      ])
      const typeBox = (await control(modal, 'create-type-select').boundingBox())!
      const kindBox = (await control(modal, 'create-kind-select').boundingBox())!
      expect(Math.abs(kindBox.y - typeBox.y), 'Kind sits beside Type').toBeLessThan(2)
      expect(kindBox.x).toBeGreaterThan(typeBox.x + typeBox.width)
      await expect(control(modal, 'create-kind-select')).toHaveText('Expression')
      await expect(valueLabel(modal)).toHaveText(OUTPUT_DEFAULT_LABEL)
      await expect(control(modal, 'create-value-area').locator('.cm-content')).toHaveText('len(rows)')
      await expect(control(modal, 'open-value-editor-button')).toHaveCount(0)
      await attach(testInfo, 'output-integer-expression.png', modal)
      await cancelCreate(page, modal)
    })

    await test.step('output, Integer, Set to null ticked: Kind gone, Type half width, one null field', async () => {
      const modal = await openFunctionCreateModal(page, 'output')
      await setCreateType(page, 'integer', modal)
      await setToNull(page, modal)
      expect(await createWindowOrder(page, modal)).toEqual([
        'name',
        'description',
        'type',
        'secret',
        'set-to-null',
        'value',
      ])
      await expect(control(modal, 'create-kind-select')).toHaveCount(0)
      await expectTypeHalfWidth(modal)
      const box = control(modal, 'create-set-to-null-checkbox')
      await expect(box).not.toHaveAttribute('aria-disabled', 'true')
      await expect(control(modal, 'create-null-field')).toHaveText('null')
      await expect(control(modal, 'create-null-field')).not.toHaveAttribute('aria-disabled', 'true')
      await expect(valueLabel(modal)).toHaveText(OUTPUT_DEFAULT_LABEL)
      await attach(testInfo, 'output-integer-set-to-null.png', modal)
      await cancelCreate(page, modal)
    })
  })

  test('the enum Allowed values list shows its fixed type as a read-only pill', async ({ page, request }, testInfo) => {
    await seedAndDigIn(page, request)

    await test.step('an ordinary list keeps its Type column', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'retries', modal)
      await setCreateType(page, 'array', modal)
      await writeValueEditor(page, modal, '[1, 2, 10]')
      const sheet = await openValueEditor(page, modal)
      expect(await listHeader(sheet)).toEqual(['#', 'Value', 'Type'])
      await expect(control(sheet, 'array-type-0')).toBeVisible()
      await closeValueEditor(page, sheet)
      await cancelCreate(page, modal)
    })

    // Per VMGR-100: the input's Type types every allowed value; the Type column shows it read-only (FIELD-10).
    await test.step('an Integer enum list shows the read-only integer pill and takes the integer color', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await setCreateName(page, 'retries', modal)
      await setCreateType(page, 'integer', modal)
      await setWindowCheckbox(modal, 'create-enum', true)
      await setAllowedValues(modal, '[1, 2, 10]')
      const sheet = await openValueEditor(page, modal, 'allowed-values')
      expect(await listHeader(sheet)).toEqual(['#', 'Value', 'Type'])
      await expectFixedTypePills(sheet, 3, 'integer')
      for (const [index, text] of ['1', '2', '10'].entries()) {
        const item = control(sheet, `array-edit-input-${index}`)
        await expect(item).toHaveValue(text)
        await expect(item, 'an Integer item takes the integer color').toHaveClass(/\btext-violet-400\b/)
      }
      await closeValueEditor(page, sheet)
      await expect(control(modal, 'create-enum-error')).toHaveCount(0)
      // An enum input needs a default from its allowed values before it can be created.
      await setWindowValue(page, modal, '2')
      await expect(control(modal, 'create-submit-button')).toBeEnabled()
      await attach(testInfo, 'input-enum-integer.png', modal)
      await cancelCreate(page, modal)
    })
  })

  test('Mark as secret forces Set to null with its tooltip; Required holds it off and keeps the default', async ({
    page,
    request,
  }, testInfo) => {
    await seedAndDigIn(page, request)

    await test.step('Required on a String input: Set to null held off, the default editable', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      const unlocked = await nullRowParts(modal)
      await control(modal, 'param-required-checkbox').click()
      expectSamePlace(await nullRowParts(modal), unlocked, 'Required locks the Set to null row')
      expect(await createWindowOrder(page, modal)).toEqual([
        'name',
        'description',
        'type',
        'required',
        'secret',
        'set-to-null',
        'create-enum',
        'value',
      ])
      await expectHeldOffByRequired(modal)
      await attach(testInfo, 'input-required.png', modal)
      await cancelCreate(page, modal)
    })

    await test.step('Mark as secret on an Array input', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await setCreateType(page, 'array', modal)
      const unlocked = await nullRowParts(modal)
      await control(modal, 'create-secret-checkbox').click()
      expectSamePlace(await nullRowParts(modal), unlocked, 'Mark as secret locks the Set to null row')
      await expect(control(modal, 'param-create-enum-checkbox'), 'an Array input has no Create enum').toHaveCount(0)
      await expectForcedNull(modal)
      await attach(testInfo, 'input-secret.png', modal)
      await expectStaysTicked(page, modal)
      await expectReasonAndRing(page, modal, 'create-secret-checkbox', SECRET_REASON)
      await cancelCreate(page, modal)
    })

    await test.step('Required and secret together show the secret text; unticking each gives the field back', async () => {
      const modal = await openFunctionCreateModal(page, 'input')
      await control(modal, 'param-required-checkbox').click()
      await control(modal, 'create-secret-checkbox').click()
      await expectForcedNull(modal)
      // Per VMGR-103: the secret reason is true for both, so it is the one shown.
      await expectReasonAndRing(page, modal, 'create-secret-checkbox', SECRET_REASON)

      await control(modal, 'create-secret-checkbox').click()
      await expectHeldOffByRequired(modal)
      await control(modal, 'param-required-checkbox').click()
      const box = control(modal, 'create-set-to-null-checkbox')
      await expect(box).toHaveAttribute('data-state', 'unchecked')
      await expect(box).not.toHaveAttribute('aria-disabled', 'true')
      await expect(noteOf(box)).toHaveCount(0)
      await expect(control(modal, 'create-null-field')).toHaveCount(0)
      await expect(valueField(modal).locator('input')).toBeEditable()
      await cancelCreate(page, modal)
    })
  })

  test('Secret and Create enum exclude each other with their hints', async ({ page, request }, testInfo) => {
    await seedAndDigIn(page, request)
    const modal = await openFunctionCreateModal(page, 'input')
    await setCreateType(page, 'integer', modal)
    const createEnum = control(modal, 'param-create-enum-checkbox')
    const secret = control(modal, 'create-secret-checkbox')
    const required = control(modal, 'param-required-checkbox')
    const setNull = control(modal, 'create-set-to-null-checkbox')

    await test.step('Create enum ticked: Mark as secret off, Required locked on, Set to null off', async () => {
      await setWindowCheckbox(modal, 'create-enum', true)
      await setAllowedValues(modal, '[1, 2, 10]')
      await expect(secret).toHaveAttribute('aria-disabled', 'true')
      await expect(secret).toHaveAttribute('data-state', 'unchecked')
      await expect(noteOf(secret)).toHaveText('off while enum is set')
      await expect(required).toHaveAttribute('aria-disabled', 'true')
      await expect(required).toHaveAttribute('data-state', 'checked')
      await expect(noteOf(required)).toHaveText('locked on while enum is set')
      await expect(setNull).toHaveAttribute('aria-disabled', 'true')
      await expect(setNull).toHaveAttribute('data-state', 'unchecked')
      await expect(noteOf(setNull)).toHaveText('off while enum is set')
      await expect(noteOf(createEnum)).toHaveCount(0)
      await attach(testInfo, 'input-enum-excludes-secret.png', modal)
    })

    await test.step('Create enum unticked: Mark as secret is free again', async () => {
      await createEnum.click()
      await expect(secret).not.toHaveAttribute('aria-disabled', 'true')
      await expect(noteOf(secret)).toHaveCount(0)
      await expect(noteOf(required)).toHaveCount(0)
    })

    await test.step('Mark as secret ticked: Create enum is off with its hint', async () => {
      await secret.click()
      await expect(createEnum).toHaveAttribute('aria-disabled', 'true')
      await expect(createEnum).toHaveAttribute('data-state', 'unchecked')
      await expect(noteOf(createEnum)).toHaveText('off while secret is set')
      await attach(testInfo, 'input-secret-excludes-enum.png', modal)
      await secret.click()
      await expect(createEnum).not.toHaveAttribute('aria-disabled', 'true')
      await expect(noteOf(createEnum)).toHaveCount(0)
    })
    await cancelCreate(page, modal)
  })
})
