/**
 * V-FIELD-TIME-PICKER: OpenSearch From / To as the one value field, and the time picker its expand opens
 * Design Decisions: FIELD-9, FIELD-1, FIELD-2, FIELD-3, OS-4
 * REQ: REQ-3.3.2.3, REQ-3.1.1.5
 *
 * Phase: no-data. Each test seeds its own `zz-11541-s2-` Test (POST /tests, zero validation errors) holding one
 * OpenSearch Block with From set to `now-15m` and To not set, and deletes it afterwards. One test per theme:
 * the dark project's theme, then the light theme through the shell toggle.
 *
 * Pass Criteria (each in both themes):
 * 1. From and To each show a gray clock icon inside the field on the left, then the expand (two diagonal
 *    arrows, `Open editor for <label>`) and the `{ }` toggle in their own columns.
 * 2. From holds `now-15m` in the string color with the reset icon; To is not set and shows `now` in Text Muted
 *    with no reset icon.
 * 3. Query language reads `DQL` and Mode `Search`, both choice lists with no expand and no `{ }`; Query is an
 *    empty field with its `{ }`.
 * 4. From's expand opens the picker: Absolute / Relative / Now tabs with Relative pressed in the primary color;
 *    Amount `15`, Unit `minutes ago`, `Round to the minute` unticked; the result line `now-15m`.
 * 5. The footer holds `Cancel` (outlined: a 1 px border) then `Save` (primary fill), right-aligned, 32 px tall.
 * 6. The picker opens below From's expand with its right edge under the expand's right edge, stays inside the
 *    window, and leaves To's and Query's `{ }` uncovered.
 * 7. A draft change shows on the result line only; Cancel discards it and the field keeps `now-15m`; Save
 *    writes `now-30m` into the field in the string color.
 * 8. After the window Save and the Test Save, the stored Test holds `from: now-30m` and no `to`.
 * 9. A screenshot of the window with the picker open is attached per theme.
 */

import { test, expect, type APIRequestContext, type Locator, type Page, type TestInfo } from '../../helpers/playwright-fixtures'
import { OPENSEARCH_PORT, OPENSEARCH_TARGET_HOST } from '../../helpers/config'
import { elementBackground, elementColor, enumTrigger, resolvedColor } from '../../helpers/config-sheet'
import { createValidTest, openTest, startEdge, validateTest } from '../../helpers/fn-seed'
import {
  deleteSeededTest,
  expectInside,
  expectNear,
  expectUncovered,
  fieldBox,
  fieldExpand,
  fieldGroup,
  fieldReset,
  fieldRow,
  fieldToggle,
  rectOf,
  settled,
  storedBlock,
} from '../../helpers/list-fields'
import { toggleTheme } from '../../helpers/theme'
import { openBlockSheet, saveBlockSheet, saveTest } from '../../helpers/workbench'
import { randomUUID } from 'node:crypto'

type Theme = 'dark' | 'light'

const OS_NODE = 'os-time'
const STRING_COLOR = 'var(--color-sky-300)'
const TEXT_MUTED = 'var(--color-text-muted)'

function openSearchNode(): Record<string, unknown> {
  return {
    id: OS_NODE,
    type: 'workflowNode',
    position: { x: 200, y: 200 },
    data: {
      label: 'OpenSearch',
      elementType: 'opensearch',
      nodeType: 'plugin',
      category: 'database',
      version: '1.0.0',
      description: '',
      hasNewerVersion: false,
      expressionFields: [],
      templateFields: [],
      config: {
        values: {
          url: `https://${OPENSEARCH_TARGET_HOST}:${OPENSEARCH_PORT}`,
          index: 'logs-*',
          from: 'now-15m',
          query_language: 'dql',
          mode: 'search',
        },
        outputBindings: {},
        profileBindings: [],
      },
    },
    measured: { width: 150, height: 62 },
  }
}

async function seed(request: APIRequestContext): Promise<string> {
  const testId = await createValidTest(request, {
    name: `zz-11541-s2-time-picker-${randomUUID().slice(0, 8)}`,
    nodes: [openSearchNode()],
    edges: [startEdge(OS_NODE)],
  })
  expect((await validateTest(request, testId)).errors, 'the seeded Test validates with zero errors').toEqual([])
  return testId
}

const timePicker = (page: Page): Locator => page.getByRole('dialog', { name: 'From', exact: true })
const resultLine = (picker: Locator): Locator => picker.locator('p[aria-live="polite"]')
const amountBox = (picker: Locator): Locator => picker.getByRole('textbox', { name: 'Amount', exact: true })

/** Clock inside the field on the left, then expand and `{ }` in their own columns (FIELD-1, FIELD-9). */
async function expectTimeRow(sheet: Locator, name: string, label: string): Promise<void> {
  const page = sheet.page()
  const clock = fieldGroup(sheet, name).locator('[data-slot="input-group-addon"] svg.lucide-clock')
  await expect(clock, `${label} shows the clock icon`).toHaveCount(1)
  expect(await elementColor(clock, 'color'), `${label} clock is gray`).toBe(await resolvedColor(page, TEXT_MUTED))
  const box = fieldBox(sheet, name)
  const clockBox = await rectOf(clock, `${label} clock`)
  const textBox = await rectOf(box, `${label} text`)
  expect(clockBox.x + clockBox.width, `${label}: the clock sits left of the text`).toBeLessThanOrEqual(textBox.x + 1)
  const expand = fieldExpand(sheet, name)
  await expect(expand).toHaveAccessibleName(`Open editor for ${label}`)
  await expect(expand.locator('svg.lucide-maximize-2'), `${label} expand is two diagonal arrows`).toHaveCount(1)
  const toggle = fieldToggle(sheet, name)
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  const group = await rectOf(fieldGroup(sheet, name), `${label} field`)
  const expandBox = await rectOf(expand, `${label} expand`)
  const toggleBox = await rectOf(toggle, `${label} {x}`)
  expect(expandBox.x, `${label}: expand right of the field`).toBeGreaterThanOrEqual(group.x + group.width)
  expect(toggleBox.x, `${label}: {x} right of the expand`).toBeGreaterThanOrEqual(expandBox.x + expandBox.width)
  expect(await box.evaluate((el) => getComputedStyle(el).fontFamily), `${label} is monospace`).toMatch(/mono/i)
}

async function expectRows(sheet: Locator): Promise<void> {
  const page = sheet.page()
  await expectTimeRow(sheet, 'from', 'From')
  await expectTimeRow(sheet, 'to', 'To')

  await expect(fieldBox(sheet, 'from')).toHaveValue('now-15m')
  expect(await elementColor(fieldBox(sheet, 'from'), 'color'), 'From holds its value in the string color').toBe(
    await resolvedColor(page, STRING_COLOR),
  )
  await expect(fieldReset(sheet, 'from'), 'From set shows the reset icon (FIELD-3)').toBeVisible()
  await expect(fieldBox(sheet, 'to')).toHaveValue('now')
  expect(await elementColor(fieldBox(sheet, 'to'), 'color'), 'To not set shows its default in Text Muted').toBe(
    await resolvedColor(page, TEXT_MUTED),
  )
  await expect(fieldReset(sheet, 'to'), 'To not set has no reset icon').toHaveCount(0)

  for (const [name, text] of [
    ['query_language', 'DQL'],
    ['mode', 'Search'],
  ] as const) {
    await expect(enumTrigger(sheet, name)).toHaveText(text)
    await expect(fieldExpand(sheet, name), `${text} choice list has no expand`).toHaveCount(0)
    await expect(fieldToggle(sheet, name), `${text} choice list has no {x}`).toHaveCount(0)
  }
  await expect(fieldBox(sheet, 'query'), 'Query is empty').toHaveValue('')
  await expect(fieldToggle(sheet, 'query'), 'Query keeps its {x}').toBeVisible()
}

/** Puts From at the top of the window's scroll area, so the picker has its room below. */
async function bringFromToTop(sheet: Locator): Promise<void> {
  await fieldRow(sheet, 'from').evaluate((row) => row.scrollIntoView({ block: 'start' }))
}

async function openPicker(sheet: Locator): Promise<Locator> {
  const picker = timePicker(sheet.page())
  await bringFromToTop(sheet)
  await fieldExpand(sheet, 'from').click()
  await expect(picker).toBeVisible()
  await settled(picker)
  return picker
}

/** Tabs with Relative pressed, Amount 15, `minutes ago`, Round unticked, result `now-15m` (FIELD-9). */
async function expectPickerBody(picker: Locator): Promise<void> {
  const page = picker.page()
  const tabs = picker.getByRole('group', { name: 'From mode', exact: true })
  const names = ['Absolute', 'Relative', 'Now'] as const
  await expect(tabs.getByRole('button')).toHaveText([...names])
  for (const name of names) {
    await expect(tabs.getByRole('button', { name, exact: true })).toHaveAttribute(
      'aria-pressed',
      name === 'Relative' ? 'true' : 'false',
    )
  }
  // The pressed tab takes the theme's primary fill.
  const pressed = `${await resolvedColor(page, 'var(--primary)')}ff`
  expect(await elementBackground(tabs.getByRole('button', { name: 'Relative', exact: true })), 'Relative is pressed').toBe(
    pressed,
  )
  expect(await elementBackground(tabs.getByRole('button', { name: 'Now', exact: true })), 'Now is not pressed').not.toBe(
    pressed,
  )
  await expect(amountBox(picker)).toHaveValue('15')
  await expect(picker.getByRole('combobox', { name: 'Unit' })).toHaveText('minutes ago')
  await expect(picker.getByRole('checkbox', { name: 'Round to the minute', exact: true })).toHaveAttribute(
    'data-state',
    'unchecked',
  )
  await expect(resultLine(picker)).toHaveText('now-15m')
}

/** Cancel outlined, then Save primary, right-aligned in the footer. */
async function expectFooter(picker: Locator): Promise<void> {
  const page = picker.page()
  const cancel = picker.getByTestId('time-picker-cancel')
  const save = picker.getByTestId('time-picker-save')
  await expect(cancel).toHaveText('Cancel')
  await expect(save).toHaveText('Save')
  await expect(cancel, 'Cancel is outlined').toHaveCSS('border-top-width', '1px')
  expect(await elementColor(cancel, 'borderTopColor'), 'Cancel border color').toBe(
    await resolvedColor(page, 'var(--color-border-default)'),
  )
  const primary = `${await resolvedColor(page, 'var(--color-primary)')}ff`
  expect(await elementBackground(save), 'Save is the primary button').toBe(primary)
  expect(await elementBackground(cancel), 'Cancel is not filled with the primary color').not.toBe(primary)
  const cancelBox = await rectOf(cancel, 'Cancel')
  const saveBox = await rectOf(save, 'Save')
  const pickerBox = await rectOf(picker, 'the picker')
  expect(cancelBox.x + cancelBox.width, 'Cancel comes before Save').toBeLessThan(saveBox.x)
  expectNear(cancelBox.y, saveBox.y, 'Cancel and Save share one row')
  expectNear(saveBox.height, 32, 'Save height')
  expectNear(cancelBox.height, 32, 'Cancel height')
  expect(pickerBox.x + pickerBox.width - (saveBox.x + saveBox.width), 'the buttons sit at the right').toBeLessThanOrEqual(14)
}

/** Under From's expand, right edges lined up, inside the window; To's and Query's {x} stay clear. */
async function expectPickerPlace(sheet: Locator, picker: Locator): Promise<void> {
  const expand = await rectOf(fieldExpand(sheet, 'from'), "From's expand")
  const box = await rectOf(picker, 'the picker')
  expectNear(box.x + box.width, expand.x + expand.width, "the picker's right edge lines up under the expand")
  expect(box.y, 'the picker opens below the expand').toBeGreaterThanOrEqual(expand.y + expand.height)
  await expectInside(picker, sheet, 'the picker')
  await expectUncovered(fieldToggle(sheet, 'to'), "To's {x}")
  await expectUncovered(fieldToggle(sheet, 'query'), "Query's {x}")
}

/** A draft shows on the result line only: Cancel keeps the field, Save writes the draft (FIELD-9). */
async function cancelThenSave(sheet: Locator, picker: Locator): Promise<void> {
  const page = sheet.page()
  await amountBox(picker).fill('30')
  await expect(resultLine(picker)).toHaveText('now-30m')
  await expect(fieldBox(sheet, 'from'), 'the draft writes nothing yet').toHaveValue('now-15m')
  await picker.getByTestId('time-picker-cancel').click()
  await expect(picker).toBeHidden()
  await expect(fieldBox(sheet, 'from'), 'Cancel discards the draft').toHaveValue('now-15m')

  const again = await openPicker(sheet)
  await expect(amountBox(again), 'the next open starts on the field again').toHaveValue('15')
  await amountBox(again).fill('30')
  await expect(resultLine(again)).toHaveText('now-30m')
  await again.getByTestId('time-picker-save').click()
  await expect(again).toBeHidden()
  await expect(fieldBox(sheet, 'from'), 'Save writes the draft').toHaveValue('now-30m')
  expect(await elementColor(fieldBox(sheet, 'from'), 'color'), 'the saved value is in the string color').toBe(
    await resolvedColor(page, STRING_COLOR),
  )
  await expect(fieldBox(sheet, 'to'), 'To stays not set').toHaveValue('now')
}

async function attach(testInfo: TestInfo, name: string, page: Page): Promise<void> {
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' })
}

test.describe('V-FIELD-TIME-PICKER: From / To and the time picker', () => {
  let testId = ''

  test.afterEach(async ({ page }) => {
    await deleteSeededTest(page, testId)
    testId = ''
  })

  for (const theme of ['dark', 'light'] as const satisfies readonly Theme[]) {
    test(`From and To, the picker, its footer and its place in the ${theme} theme`, async ({ page }, testInfo) => {
      testId = await seed(page.request)
      await openTest(page, testId)
      if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
      const sheet = await openBlockSheet(page, OS_NODE)

      await test.step('From, To and the other rows', () => expectRows(sheet))
      const picker = await openPicker(sheet)
      await test.step('the picker body', () => expectPickerBody(picker))
      await test.step('the picker footer', () => expectFooter(picker))
      await test.step("the picker's place", () => expectPickerPlace(sheet, picker))
      await attach(testInfo, `time-picker-${theme}.png`, page)
      await test.step('Cancel discards, Save writes', () => cancelThenSave(sheet, picker))

      await test.step('the stored Test', async () => {
        await saveBlockSheet(sheet)
        await saveTest(page)
        const values = (await storedBlock(page.request, testId, OS_NODE)).config.values as Record<string, unknown>
        expect(values.from, 'From is stored as saved').toBe('now-30m')
        expect('to' in values, 'To stays not set').toBe(false)
      })
    })
  }
})
