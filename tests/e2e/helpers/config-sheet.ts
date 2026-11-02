/** Reads of a Block config sheet shared by the plugin sheet specs. */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { leaveExpressionEditor } from './code-editor'
import { listItem } from './entry-editors'

export const paramRow = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-row-${name}"]`)
export const outputRow = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="output-row-${name}"]`)
export const exprToggle = (sheet: Locator, name: string): Locator =>
  paramRow(sheet, name).locator('[data-testid="expression-toggle"]')
export const requiredStar = (sheet: Locator, name: string): Locator =>
  paramRow(sheet, name).locator('td:nth-child(2) span.text-destructive')
export const enumTrigger = (sheet: Locator, name: string): Locator =>
  paramRow(sheet, name).locator('button[role="combobox"]')
export const checkbox = (sheet: Locator, name: string): Locator =>
  paramRow(sheet, name).locator('button[role="checkbox"]')
/** A row's one value field text box (text, list, map, table and time rows): read it with toHaveValue (FIELD-1). */
export const editPreview = (sheet: Locator, name: string): Locator =>
  paramRow(sheet, name).locator('input[data-slot="input-group-control"]')
// The field's own buttons; helpers/value-field.ts exports them for specs (it imports this file).
const expandOf = (sheet: Locator, name: string): Locator => sheet.locator(`[data-testid="param-expand-${name}"]`)
const resetOf = (sheet: Locator, name: string): Locator => sheet.locator(`[data-testid="param-reset-${name}"]`)
export const numberInput = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-input-${name}"]`)
export const browseButton = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-browse-${name}"]`)
export const groupHeader = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="group-header-${name}"]`)
export const secretsTrigger = (sheet: Locator): Locator =>
  sheet.locator('[data-testid="secrets-section-trigger"]')
export const settingsNote = (sheet: Locator): Locator => sheet.locator('[data-testid="save-blocked-note"]')
export const saveButton = (sheet: Locator): Locator => sheet.getByRole('button', { name: 'Save', exact: true })
export const rowError = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-error-${name}"]`)
export const rowWarning = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-warning-${name}"]`)
/** Every save-blocking row message on the input side. */
export const rowAlerts = (sheet: Locator): Locator => sheet.locator('[data-testid^="param-row-"] [role="alert"]')

/** FIELDERR-3: a fresh sheet flags each of its empty required rows at once, and nothing else. */
export async function expectOnlyRequiredFlags(sheet: Locator): Promise<void> {
  const flagged = await sheet.locator('[data-testid^="param-error-"]').evaluateAll((elements) =>
    elements.map((element) => ({
      name: (element.getAttribute('data-testid') ?? '').replace('param-error-', ''),
      text: element.textContent ?? '',
    })),
  )
  await expect(sheet.locator('[role="alert"]'), 'every alert is a row message').toHaveCount(flagged.length)
  for (const { name, text } of flagged) {
    expect(text, `${name} carries only its required message`).toMatch(/^.+ is required$/)
    await expect(requiredStar(sheet, name), `${name} is a required row`).toHaveCount(1)
  }
}

/** The input side in DOM order: row names, [Group] headers and [Secrets]. */
export function inputLayout(sheet: Locator): Promise<string[]> {
  return sheet.evaluate((root) =>
    Array.from(
      root.querySelectorAll(
        '[data-testid^="param-row-"], [data-testid^="group-header-"], [data-testid="secrets-section-trigger"]',
      ),
    ).map((el) => {
      const id = el.getAttribute('data-testid') ?? ''
      if (id.startsWith('param-row-')) return id.slice('param-row-'.length)
      if (id.startsWith('group-header-')) return `[${id.slice('group-header-'.length)}]`
      return '[Secrets]'
    }),
  )
}

export async function expectLayout(sheet: Locator, expected: string[], label: string): Promise<void> {
  await expect.poll(() => inputLayout(sheet), { message: label }).toEqual(expected)
}

export async function expectOutputs(sheet: Locator, expected: string[], label: string): Promise<void> {
  const rows = sheet.locator('[data-testid^="output-row-"]')
  await expect
    .poll(
      () => rows.evaluateAll((els) => els.map((el) => (el.getAttribute('data-testid') ?? '').replace('output-row-', ''))),
      { message: label },
    )
    .toEqual(expected)
}

export async function headerTexts(table: Locator): Promise<string[]> {
  return table.locator('thead th').evaluateAll((cells) => cells.map((c) => (c.textContent ?? '').trim()))
}

/** The row's visible label, without the screen-reader "required" suffix. */
export function rowLabel(sheet: Locator, name: string): Promise<string> {
  return paramRow(sheet, name)
    .locator('td:nth-child(2)')
    .evaluate((cell) => (cell.textContent ?? '').replace(/\*\s*required$/, '').trim())
}

export async function openOptions(page: Page, sheet: Locator, name: string): Promise<Locator> {
  const trigger = enumTrigger(sheet, name)
  await trigger.scrollIntoViewIfNeeded()
  await trigger.click()
  // A suggestion list is a cmdk listbox that can linger hidden while it animates out.
  const listbox = page.locator('[role="listbox"]:not([cmdk-list])')
  await expect(listbox).toBeVisible()
  return listbox
}

export async function pickEnum(page: Page, sheet: Locator, name: string, optionLabel: string): Promise<void> {
  const listbox = await openOptions(page, sheet, name)
  await listbox.getByRole('option', { name: optionLabel, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(enumTrigger(sheet, name)).toHaveText(optionLabel)
}

/** Assert the options a select offers, then close it by picking the value it already shows. */
export async function expectOptions(page: Page, sheet: Locator, name: string, labels: string[]): Promise<void> {
  const current = ((await enumTrigger(sheet, name).textContent()) ?? '').trim()
  const listbox = await openOptions(page, sheet, name)
  await expect(listbox.getByRole('option'), `${name} options`).toHaveText(labels)
  await listbox.getByRole('option', { name: current, exact: true }).click()
  await expect(listbox).toHaveCount(0)
  await expect(enumTrigger(sheet, name)).toHaveText(current)
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** One row's parts, each measured from the row's own top-left corner. */
export interface RowGeometry {
  row: Box
  info: Box | null
  label: Box | null
  type: Box | null
  field: Box | null
  toggle: Box | null
  message: Box | null
}

/** A row's parts measured in one pass, so a scroll between two reads cannot skew them. */
export function rowGeometry(sheet: Locator, name: string, field: string): Promise<RowGeometry> {
  return paramRow(sheet, name).evaluate(
    (row, { fieldSelector, rowName }) => {
      const origin = row.getBoundingClientRect()
      const measure = (el: Element | null) => {
        if (!el) return null
        const r = el.getBoundingClientRect()
        return { x: r.x - origin.x, y: r.y - origin.y, width: r.width, height: r.height }
      }
      return {
        row: { x: origin.x, y: origin.y, width: origin.width, height: origin.height },
        info: measure(row.querySelector('td:nth-child(1) svg')),
        label: measure(row.querySelector('td:nth-child(2) span')),
        type: measure(row.querySelector('td:nth-child(3) span')),
        field: measure(row.querySelector(fieldSelector)),
        toggle: measure(row.querySelector('[data-testid="expression-toggle"]')),
        message: measure(
          row.querySelector(`[data-testid="param-error-${rowName}"], [data-testid="param-warning-${rowName}"]`),
        ),
      }
    },
    { fieldSelector: field, rowName: name },
  )
}

/** A CSS color as sRGB hex, so a token and a computed color compare whatever syntax declares them. */
export function resolvedColor(page: Page, cssColor: string): Promise<string> {
  return page.evaluate((color) => {
    const probe = document.createElement('span')
    probe.style.color = color
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    probe.remove()
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = computed
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  }, cssColor)
}

/** An element's computed text or top border color, as sRGB hex. */
export function elementColor(target: Locator, property: 'color' | 'borderTopColor'): Promise<string> {
  return target.evaluate((el, prop) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el)[prop]
    ctx.fillRect(0, 0, 1, 1)
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
    return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  }, property)
}

// --- OpenSearch sheet drivers: From / To picker, Stats entries, field and index suggestions (OS-4, OS-6, OS-7, OS-13) ---

/** One open-and-act step retried whole until its own assertions hold, so a popover a re-render closed is reopened. */
async function openAndAct(act: () => Promise<void>): Promise<void> {
  await expect(act).toPass({ timeout: 20_000, intervals: [250, 500, 1_000] })
}

/** A Radix Select's open option list, never a suggestion list (those are cmdk lists). */
const selectListbox = (page: Page): Locator => page.locator('[role="listbox"]:not([cmdk-list])')

/** Pick `optionLabel` in a Radix Select unless it already shows it. */
async function chooseSelectOption(page: Page, trigger: Locator, optionLabel: string): Promise<void> {
  if (((await trigger.textContent()) ?? '').trim() !== optionLabel) {
    await trigger.click()
    await selectListbox(page).getByRole('option', { name: optionLabel, exact: true }).click({ timeout: 3_000 })
  }
  await expect(trigger).toHaveText(optionLabel, { timeout: 2_000 })
}

/** Set a Radix checkbox to `checked` unless it already is. */
async function setChecked(box: Locator, checked: boolean): Promise<void> {
  const state = checked ? 'checked' : 'unchecked'
  if ((await box.getAttribute('data-state')) !== state) await box.click()
  await expect(box).toHaveAttribute('data-state', state, { timeout: 2_000 })
}

/** The Absolute / Relative / Now tabs of a time popover. */
export type TimeTab = 'Absolute' | 'Relative' | 'Now'

/** The Relative tab's controls; `unit` is the Unit option label, such as `minutes ago` or `hours from now`. */
export interface RelativeTime {
  amount?: number
  unit?: string
  round?: boolean
}

/** What opens a time row's picker: the row's expand, beside the one value field with the clock icon (FIELD-9). */
export const timeTrigger = (sheet: Locator, name: string): Locator => expandOf(sheet, name)

/** The popover a time row opens: a dialog named after the row label (From, To). */
export const timePopover = (page: Page, label: string): Locator =>
  page.getByRole('dialog', { name: label, exact: true })

/** The `<label> mode` tab strip of a time popover. */
export const timeTabStrip = (popover: Locator, label: string): Locator =>
  popover.getByRole('group', { name: `${label} mode`, exact: true })

/** The mono line at the foot of a Relative or Now tab (`now-15m`, `now`). */
export const timeResultLine = (popover: Locator): Locator => popover.locator('p.font-mono')

/** The Absolute tab's `Date and time` box. */
export const timeDateBox = (popover: Locator): Locator =>
  popover.getByRole('textbox', { name: 'Date and time', exact: true })

async function ensureTimePopoverOpen(sheet: Locator, name: string, popover: Locator): Promise<void> {
  if (!(await popover.isVisible())) {
    const trigger = timeTrigger(sheet, name)
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
  }
  await expect(popover).toBeVisible({ timeout: 2_000 })
}

async function ensureTimeTab(popover: Locator, label: string, tab: TimeTab): Promise<void> {
  const button = timeTabStrip(popover, label).getByRole('button', { name: tab, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true', { timeout: 2_000 })
}

/** Open a time row's picker from its expand (clicked only while it is shut) and return it. */
export async function openTimePicker(page: Page, sheet: Locator, name: string): Promise<Locator> {
  const popover = timePopover(page, await rowLabel(sheet, name))
  await openAndAct(() => ensureTimePopoverOpen(sheet, name, popover))
  return popover
}

/** Open a time row's picker on `tab` (the tab change is a draft until Save) and return it. */
export async function pickTimeTab(page: Page, sheet: Locator, name: string, tab: TimeTab): Promise<Locator> {
  const label = await rowLabel(sheet, name)
  const popover = timePopover(page, label)
  await openAndAct(async () => {
    await ensureTimePopoverOpen(sheet, name, popover)
    await ensureTimeTab(popover, label, tab)
  })
  return popover
}

/** Set the Relative tab's Amount, Unit and Round to the unit in the draft, leaving out what is not given. */
export async function setRelativeTime(
  page: Page,
  sheet: Locator,
  name: string,
  { amount, unit, round }: RelativeTime,
): Promise<Locator> {
  const label = await rowLabel(sheet, name)
  const popover = timePopover(page, label)
  await openAndAct(async () => {
    await ensureTimePopoverOpen(sheet, name, popover)
    await ensureTimeTab(popover, label, 'Relative')
    if (amount !== undefined) {
      const box = popover.getByRole('textbox', { name: 'Amount', exact: true })
      await box.fill(String(amount))
      await expect(box).toHaveValue(String(amount), { timeout: 2_000 })
    }
    if (unit !== undefined) await chooseSelectOption(page, popover.getByRole('combobox', { name: 'Unit' }), unit)
    if (round !== undefined) await setChecked(popover.getByRole('checkbox', { name: /^Round to the / }), round)
  })
  return popover
}

/** Type an ISO timestamp into the Absolute tab's `Date and time` box and apply it to the draft with Enter. */
export async function setAbsoluteTime(page: Page, sheet: Locator, name: string, iso: string): Promise<Locator> {
  const label = await rowLabel(sheet, name)
  const popover = timePopover(page, label)
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(iso) ? iso : `${iso}Z`
  const applied = `${new Date(zoned).toISOString().slice(0, 19)}Z`
  await openAndAct(async () => {
    await ensureTimePopoverOpen(sheet, name, popover)
    await ensureTimeTab(popover, label, 'Absolute')
    const box = timeDateBox(popover)
    await box.fill(iso)
    await box.press('Enter')
    await expect(box).toHaveValue(applied, { timeout: 2_000 })
    await expect(box).not.toHaveAttribute('aria-invalid', 'true')
  })
  return popover
}

/** Write the picker's draft into the field with Save; the picker closes. */
export async function saveTimePicker(popover: Locator): Promise<void> {
  await popover.locator('[data-testid="time-picker-save"]').click()
  await expect(popover).toBeHidden()
}

/** Leave the picker with Cancel, its draft discarded. */
export async function cancelTimePicker(popover: Locator): Promise<void> {
  await popover.locator('[data-testid="time-picker-cancel"]').click()
  await expect(popover).toBeHidden()
}

/** Close a time picker with Esc, its draft discarded, and wait for it to go. */
export async function closeTimePicker(page: Page, popover: Locator): Promise<void> {
  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
}

/** A Stats entry's trigger in the open Stats editor, 0-based: the sigma glyph and the entry in words. */
export const statTrigger = (editor: Locator, index: number): Locator => listItem(editor, index).valueInput

/** The popover of the Stats entry at 0-based `index`: a dialog named `Stat <n>`. */
export const statPopover = (page: Page, index: number): Locator =>
  page.getByRole('dialog', { name: `Stat ${index + 1}`, exact: true })

/** The mono line at the foot of a stat popover: the column name, or `Pick a field`. */
export const statColumnLine = (popover: Locator): Locator => popover.locator('p.font-mono')

/** A stat popover's Field box, a suggestion combobox. */
export const statFieldBox = (popover: Locator): Locator =>
  popover.getByRole('combobox', { name: 'Field', exact: true })

/** What `setStatEntry` writes; `stat` is the Stat option label, such as `Percentile` or `Custom (JSON)`. */
export interface StatEntryInput {
  stat?: string
  percent?: number
  field?: string
  columnName?: string
}

async function ensureStatPopoverOpen(editor: Locator, index: number, popover: Locator): Promise<void> {
  if (!(await popover.isVisible())) {
    const trigger = statTrigger(editor, index)
    await trigger.scrollIntoViewIfNeeded()
    await trigger.click()
  }
  await expect(popover).toBeVisible({ timeout: 2_000 })
}

/** Open the popover of the Stats entry at 0-based `index` in the open Stats editor and return it. */
export async function openStatEntry(page: Page, editor: Locator, index: number): Promise<Locator> {
  const popover = statPopover(page, index)
  await openAndAct(() => ensureStatPopoverOpen(editor, index, popover))
  return popover
}

/** Set a Stats entry's Stat, Percent, Field and Column name, leaving out what is not given; returns its popover. */
export async function setStatEntry(
  page: Page,
  editor: Locator,
  index: number,
  { stat, percent, field, columnName }: StatEntryInput,
): Promise<Locator> {
  const popover = statPopover(page, index)
  await openAndAct(async () => {
    await ensureStatPopoverOpen(editor, index, popover)
    if (stat !== undefined) await chooseSelectOption(page, popover.getByRole('combobox', { name: 'Stat', exact: true }), stat)
    if (percent !== undefined) {
      const box = popover.locator('[data-testid="stat-percent"]')
      await box.fill(String(percent))
      await expect(box).toHaveValue(String(percent), { timeout: 2_000 })
    }
    if (field !== undefined) await typeSuggestText(statFieldBox(popover), field)
    if (columnName !== undefined) {
      const box = popover.getByRole('textbox', { name: 'Column name', exact: true })
      await box.fill(columnName)
      await expect(box).toHaveValue(columnName, { timeout: 2_000 })
    }
  })
  return popover
}

/** Click Add stat in the open Stats editor: a `Sum (no field)` entry is appended and its popover opens. */
export async function addStatEntry(page: Page, editor: Locator): Promise<Locator> {
  const index = await listItems(editor).count()
  const add = listAddButton(editor)
  await expect(add).toHaveText('Add stat')
  await add.scrollIntoViewIfNeeded()
  await add.click()
  await expect(listItems(editor)).toHaveCount(index + 1)
  const popover = statPopover(page, index)
  await expect(popover).toBeVisible()
  return popover
}

/** The one value field of a row that suggests names (Index pattern, Group by field, Sort by, Time field). */
export const suggestInput = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-input-${name}"]`)

/** The field box of a Fields editor row, 0-based. */
export const listEntry = (editor: Locator, index: number): Locator => listItem(editor, index).valueInput

/** The open suggestion list of a field or index box: its options, then its footer. */
export const suggestList = (page: Page): Locator =>
  page
    .locator('[data-radix-popper-content-wrapper]')
    .filter({ has: page.locator('[cmdk-root]') })
    .filter({ visible: true })

/** One suggestion by its exact name. */
export const suggestOption = (list: Locator, name: string): Locator =>
  list.locator(`[cmdk-item][data-value=${JSON.stringify(name)}]`)

/** Close a box's open suggestion list with Esc; the list takes the key, so the sheet stays open. */
export async function dismissSuggestions(box: Locator): Promise<void> {
  if ((await box.getAttribute('aria-expanded')) === 'true') await box.press('Escape')
  await expect(box).toHaveAttribute('aria-expanded', 'false', { timeout: 2_000 })
  await expect(suggestList(box.page())).toHaveCount(0)
}

/** Replace a field or index box's text key by key (a gray default takes no fill), then close the list typing opened. */
export async function typeSuggestText(box: Locator, text: string): Promise<void> {
  await box.click()
  await box.press('ControlOrMeta+a')
  if (text === '') await box.press('Backspace')
  else await box.pressSequentially(text)
  await dismissSuggestions(box)
  await expect(box).toHaveValue(text, { timeout: 2_000 })
}

async function ensureSuggestionsOpen(page: Page, box: Locator): Promise<Locator> {
  const list = suggestList(page)
  if ((await box.getAttribute('aria-expanded')) !== 'true') {
    await box.scrollIntoViewIfNeeded()
    await box.click()
  }
  await expect(list).toBeVisible({ timeout: 2_000 })
  return list
}

/** Open a field or index box's suggestion list (a click opens it) and return the list. */
export async function openSuggestions(page: Page, box: Locator): Promise<Locator> {
  await openAndAct(async () => {
    await ensureSuggestionsOpen(page, box)
  })
  return suggestList(page)
}

/** Pick `name` from a field or index box's suggestion list; the box then holds it. */
export async function pickSuggestion(page: Page, box: Locator, name: string): Promise<void> {
  await openAndAct(async () => {
    const list = await ensureSuggestionsOpen(page, box)
    await suggestOption(list, name).click({ timeout: 2_000 })
    await expect(box).toHaveValue(name, { timeout: 2_000 })
  })
}

/** Click the list footer's action: `Get fields`, `Get indexes`, or the `... Try again` line after a failure. */
export async function clickSuggestFooter(page: Page, box: Locator, action: string): Promise<void> {
  await openAndAct(async () => {
    const list = await ensureSuggestionsOpen(page, box)
    await list.getByRole('button', { name: action, exact: true }).click({ timeout: 2_000 })
  })
}

/** Click Add field in the open Fields editor, type the entry and close its suggestions; returns the new entry's box. */
export async function addFieldEntry(editor: Locator, value: string): Promise<Locator> {
  const index = await listItems(editor).count()
  const add = listAddButton(editor)
  await expect(add).toHaveText('Add field')
  await add.scrollIntoViewIfNeeded()
  await add.click()
  await expect(listItems(editor)).toHaveCount(index + 1)
  const box = listEntry(editor, index)
  await expect(box).toBeFocused()
  await typeSuggestText(box, value)
  return box
}

// --- The shared list editor a list field's expand opens: Arguments, Out arguments, Fields, Stats (FIELD-10, FIELD-13) ---

/** The Edit value sheet holding a list editor (the first level when a nested one is open). */
export const listEditorSheet = (page: Page): Locator =>
  page
    .locator('[data-testid="value-editor-sheet"]')
    .filter({ has: page.locator('[data-testid="array-edit-body"]') })
    .first()

/** Open a list row's editor from its expand and return the sheet. */
export async function openListEditor(page: Page, sheet: Locator, name: string): Promise<Locator> {
  const expand = expandOf(sheet, name)
  await expand.scrollIntoViewIfNeeded()
  await expand.click()
  const editor = listEditorSheet(page)
  await expect(editor, `the ${name} list editor`).toBeVisible()
  return editor
}

/** One position cell per item, in order. */
export const listItems = (editor: Locator): Locator => editor.locator('[data-testid="array-edit-index"]')

/** The position labels the items show (`$1`, `1`, `0`). */
export function listPositions(editor: Locator): Promise<string[]> {
  return listItems(editor).allTextContents()
}

// An item's parts (box, {x}, null button, remove) come from helpers/entry-editors.ts `listItem`.
export const listMoveUp = (editor: Locator, index: number): Locator =>
  editor.locator(`[data-testid="array-move-up-${index}"]`)
export const listMoveDown = (editor: Locator, index: number): Locator =>
  editor.locator(`[data-testid="array-move-down-${index}"]`)
/** Add, named by its text (`Add argument`, `Add field`, `Add stat`, SHRUN-4). */
export const listAddButton = (editor: Locator): Locator => editor.locator('[data-testid="array-add-item"]')

/** Click Add and, when given, type the new item's text; returns the new item's box. */
export async function addListItem(editor: Locator, text?: string): Promise<Locator> {
  const index = await listItems(editor).count()
  await listAddButton(editor).click()
  await expect(listItems(editor)).toHaveCount(index + 1)
  const box = listItem(editor, index).valueInput
  if (text !== undefined) {
    await box.fill(text)
    await expect(box).toHaveValue(text)
  }
  return box
}


/** Press a {x} toggle and answer the switch warning with Clear when it asks; the toggle ends `pressed`. */
async function switchExpression(page: Page, toggle: Locator, pressed: boolean): Promise<void> {
  await toggle.click()
  const dialog = page.locator('[data-testid="switch-mode-dialog"]')
  await expect(async () => {
    if (await dialog.isVisible()) await dialog.locator('[data-testid="switch-mode-clear-default"]').click()
    await expect(toggle).toHaveAttribute('aria-pressed', String(pressed), { timeout: 1_000 })
  }).toPass({ timeout: 10_000 })
  await expect(dialog).toHaveCount(0)
}

/** Replace a code editor's text in one input, so quote and bracket pairing leaves it alone. */
async function replaceCode(page: Page, editor: Locator, text: string): Promise<void> {
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Delete')
  await page.keyboard.insertText(text)
  await expect(editor).toHaveText(text)
  await leaveExpressionEditor(editor)
}

/** Switch an item to {x} (Clear when the warning asks) and type its expression. */
export async function setListItemExpression(page: Page, editor: Locator, index: number, expression: string): Promise<void> {
  const item = listItem(editor, index)
  if ((await item.exprToggle.getAttribute('aria-pressed')) !== 'true') await switchExpression(page, item.exprToggle, true)
  await replaceCode(page, item.exprBox.locator('.cm-content'), expression)
}

/** Apply the list editor (Save keeps it open and goes dead), then Close it. */
export async function saveListEditor(editor: Locator): Promise<void> {
  const save = editor.locator('[data-testid="value-editor-save-button"]')
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled()
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  await expect(editor).toBeHidden()
}

/** Close an Edit value sheet, discarding what it holds unsaved. */
export async function closeValueEditor(page: Page, editor: Locator): Promise<void> {
  await editor.locator('[data-testid="value-editor-cancel-button"]').click()
  const discard = page.locator('[data-testid="value-editor-unsaved-discard-button"]')
  if (await discard.isVisible({ timeout: 2_000 }).catch(() => false)) await discard.click()
  await expect(editor).toBeHidden()
}

/** Open a text row's Edit value sheet from its expand and return it. */
export async function openFieldEditor(page: Page, sheet: Locator, name: string): Promise<Locator> {
  const expand = expandOf(sheet, name)
  await expand.scrollIntoViewIfNeeded()
  await expand.click()
  const editor = page.locator('[data-testid="value-editor-sheet"]').first()
  await expect(editor, `the ${name} editor`).toBeVisible()
  return editor
}

/** Type a text row's value into its one value field key by key (a gray default takes no fill). */
export async function typeFieldText(sheet: Locator, name: string, text: string): Promise<void> {
  const box = editPreview(sheet, name)
  await box.click()
  await box.press('ControlOrMeta+a')
  if (text === '') await box.press('Backspace')
  else await box.pressSequentially(text)
  await expect(box).toHaveValue(text)
}

/** An element's computed background color as sRGB hex with its alpha (`#rrggbbaa`), so a tinted fill compares exactly. */
export function elementBackground(target: Locator): Promise<string> {
  return target.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    ctx.fillStyle = getComputedStyle(el).backgroundColor
    ctx.fillRect(0, 0, 1, 1)
    return `#${[...ctx.getImageData(0, 0, 1, 1).data].map((n) => n.toString(16).padStart(2, '0')).join('')}`
  })
}

/** Type a variable name into an output row's Assign to box and leave it. */
export async function bindOutput(sheet: Locator, name: string, variable: string): Promise<void> {
  const box = outputRow(sheet, name).locator('[role="combobox"]').first()
  await box.click()
  await box.fill(variable)
  await box.press('Tab')
  await expect(box).toHaveValue(variable)
}

/** Turn a row's {x} on (Clear when the switch warning asks) and type an expression; any suggestion list is closed. */
export async function setRowExpression(page: Page, sheet: Locator, name: string, expression: string): Promise<void> {
  const toggle = exprToggle(sheet, name)
  if ((await toggle.getAttribute('aria-pressed')) !== 'true') await switchExpression(page, toggle, true)
  await expect(toggle).toHaveAttribute('data-state', 'on')
  const editor = codeField(sheet, name)
  await replaceCode(page, editor, expression)
  await expect(sheet).toBeVisible()
  await expect(editor).toHaveText(expression)
}

/** Turn a row's {x} off (Clear when the switch warning asks): the field is back to its literal box. */
export async function clearRowExpression(page: Page, sheet: Locator, name: string): Promise<void> {
  const toggle = exprToggle(sheet, name)
  if ((await toggle.getAttribute('aria-pressed')) === 'true') await switchExpression(page, toggle, false)
  await expect(toggle).toHaveAttribute('data-state', 'off')
}

/** Pick a variable in a variable-reference row (the For Each collection) from its list. */
export async function pickVariableRef(page: Page, sheet: Locator, name: string, variable: string): Promise<void> {
  const box = paramRow(sheet, name).locator('textarea[role="combobox"]')
  await box.click()
  await box.fill(variable)
  const option = page.getByRole('option').filter({ has: page.getByText(variable, { exact: true }) })
  await expect(option, `${variable} is offered for ${name}`).toHaveCount(1)
  await option.click()
  await expect(box).toHaveValue(variable)
  await expect(page.getByRole('option')).toHaveCount(0)
}

// --- Input field kinds: the one value field each value type draws, empty or showing a gray default (FIELD-1, FIELD-2) ---

/** The value types a Block input row draws a field for. */
export type FieldKind = 'string' | 'integer' | 'float' | 'boolean' | 'array' | 'map' | 'table'

export const FIELD_KINDS: readonly FieldKind[] = ['string', 'integer', 'float', 'boolean', 'array', 'map', 'table']

/** A row's expression editor text. */
export const codeField = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-input-${name}"] .cm-content`)

/** The held default an empty expression editor shows in place of text. */
export const codePlaceholder = (sheet: Locator, name: string): Locator =>
  sheet.locator(`[data-testid="param-input-${name}"] .cm-placeholder`)

/** The literal box a row of `kind` draws: the one-line text box, the number box or the checkbox. */
export function literalField(sheet: Locator, name: string, kind: FieldKind): Locator {
  if (kind === 'integer' || kind === 'float') return numberInput(sheet, name)
  if (kind === 'boolean') return checkbox(sheet, name)
  return editPreview(sheet, name)
}

/** A row in literal mode drawing the box of its kind. */
export async function expectLiteralMode(sheet: Locator, name: string, kind: FieldKind): Promise<void> {
  await expect(exprToggle(sheet, name), `${name} opens as its literal box`).toHaveAttribute('aria-pressed', 'false')
  const field = literalField(sheet, name, kind)
  await expect(field, `${name}: the ${kind} box`).toBeVisible()
  if (kind !== 'boolean') await expect(field).toHaveJSProperty('tagName', 'INPUT')
}

/** A literal row that holds nothing and has no default: an empty box, never the word null (REQ-3.1.3.20). */
export async function expectEmptyLiteralField(sheet: Locator, name: string, kind: FieldKind): Promise<void> {
  await expectLiteralMode(sheet, name, kind)
  const field = literalField(sheet, name, kind)
  if (kind === 'boolean') {
    await expect(field, `${name}: the box is unticked`).toHaveAttribute('data-state', 'unchecked')
  } else {
    await expect(field, `${name}: the box is empty`).toHaveValue('')
    if (kind === 'integer' || kind === 'float') {
      expect(await field.getAttribute('placeholder'), `${name}: no placeholder, never null`).toBeNull()
    }
  }
  await expect(paramRow(sheet, name).locator('td').nth(3), `${name}: never the word null`).not.toContainText(/\bnull\b/)
}

/** An expression row that holds nothing and has no default: no text, no placeholder. */
export async function expectEmptyCodeField(sheet: Locator, name: string): Promise<void> {
  await expect(exprToggle(sheet, name)).toHaveAttribute('aria-pressed', 'true')
  await expect(codeField(sheet, name), `${name}: the code field is empty`).toHaveText('')
  await expect(codePlaceholder(sheet, name), `${name}: no placeholder, never null`).toHaveCount(0)
}

/** A literal row showing its default in the Text Muted gray as real text, never a value it holds (FIELD-2). */
export async function expectHeldDefault(
  page: Page,
  sheet: Locator,
  name: string,
  kind: FieldKind,
  shown: string,
): Promise<void> {
  await expectLiteralMode(sheet, name, kind)
  const field = literalField(sheet, name, kind)
  if (kind === 'boolean') {
    // A true / false field always holds its value, never a gray tick (FIELD-8).
    await expect(field).toHaveAttribute('data-state', shown === 'true' ? 'checked' : 'unchecked')
    return
  }
  await expect(field, `${name}: the default`).toHaveValue(shown)
  const muted = await resolvedColor(page, 'var(--color-text-muted)')
  expect(await elementColor(field, 'color'), `${name}: the default is gray`).toBe(muted)
  await expect(resetOf(sheet, name), `${name}: no reset while not set`).toHaveCount(0)
}

/** A literal row showing a value it holds, in its value color. */
export async function expectHeldValue(
  page: Page,
  sheet: Locator,
  name: string,
  kind: FieldKind,
  shown: string,
): Promise<void> {
  await expectLiteralMode(sheet, name, kind)
  const field = literalField(sheet, name, kind)
  if (kind === 'boolean') {
    await expect(field).toHaveAttribute('data-state', shown === 'true' ? 'checked' : 'unchecked')
    return
  }
  await expect(field, `${name}: the value`).toHaveValue(shown)
  const muted = await resolvedColor(page, 'var(--color-text-muted)')
  expect(await elementColor(field, 'color'), `${name}: a held value is not gray`).not.toBe(muted)
}
