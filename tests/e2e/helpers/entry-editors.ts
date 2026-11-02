/**
 * The list, map, table and Parts entry editors (FIELD-1, FIELD-10, FIELD-13): opening them from a Block row or a
 * variable window, the parts of one entry (key box, value box, null button, {x}, expand, Type pill), and the
 * geometry and computed-style reads their look specs assert. Selectors only, never class names.
 */

import { expect, type Locator, type Page } from './playwright-fixtures'
import { toggleTheme } from './theme'
import {
  cancelWindow,
  editWindow,
  openEditWindow,
  openValueEditor,
  setValueEditorView,
  type CloseAnswer,
} from './variable-create'

const VALUE_SHEET = '[data-testid="value-editor-sheet"]'
const PARTS_SHEET = '[data-testid="parts-editor-sheet"]'
const OPEN_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"])'
const ROW_BOX = '[data-slot="input-group"]'

/** Every open "Edit value" sheet, the one opened from the field first. */
export function valueSheets(page: Page): Locator {
  return page.locator(VALUE_SHEET)
}

/** The Block row's expand, which opens the field's full editor (FIELD-1). */
export function blockExpand(sheet: Locator, name: string): Locator {
  return sheet.locator(`[data-testid="param-expand-${name}"]`)
}

/** Expand a Block config sheet's group card unless it is open already. */
export async function expandGroup(sheet: Locator, group: string): Promise<void> {
  const header = sheet.locator(`[data-testid="group-header-${group}"]`)
  if ((await header.getAttribute('aria-expanded')) !== 'true') await header.click()
  await expect(header).toHaveAttribute('aria-expanded', 'true')
}

/** Close a Block config sheet that holds no change, from its footer Cancel. */
export async function closeBlockSheet(sheet: Locator): Promise<void> {
  await sheet.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(sheet).toHaveCount(0)
}

/** Click `open` and return the "Edit value" sheet it adds, in its Visual view unless `view` says otherwise. */
async function openNewValueSheet(
  page: Page,
  open: () => Promise<void>,
  view: 'Visual' | 'Code' | null,
): Promise<Locator> {
  const sheets = valueSheets(page)
  const before = await sheets.count()
  await open()
  await expect(sheets).toHaveCount(before + 1)
  const sheet = sheets.nth(before)
  await expect(sheet).toBeVisible()
  if (view !== null && (await sheet.locator('[data-testid="view-dropdown"]').count()) > 0) {
    await setValueEditorView(page, sheet, view)
  }
  return sheet
}

/** Open a Block row's list, map or table editor from its expand; `view: null` leaves the view as it opens. */
export async function openBlockEditor(
  page: Page,
  sheet: Locator,
  name: string,
  view: 'Visual' | 'Code' | null = 'Visual',
): Promise<Locator> {
  const expand = blockExpand(sheet, name)
  await expand.scrollIntoViewIfNeeded()
  return openNewValueSheet(page, () => expand.click(), view)
}

/** Open a Block row's Parts editor (multipart body) from its expand. */
export async function openPartsEditor(page: Page, sheet: Locator, name = 'parts'): Promise<Locator> {
  const expand = blockExpand(sheet, name)
  await expand.scrollIntoViewIfNeeded()
  await expand.click()
  const parts = page.locator(PARTS_SHEET)
  await expect(parts).toBeVisible()
  return parts
}

/** Open a Test variable's value in its Edit window's "Edit value" sheet, in the Visual view. */
export async function openVariableEditor(page: Page, name: string): Promise<Locator> {
  const win = await openEditWindow(page, name)
  const sheet = await openValueEditor(page, win)
  if ((await sheet.locator('[data-testid="view-dropdown"]').count()) > 0) {
    await setValueEditorView(page, sheet, 'Visual')
  }
  return sheet
}

/** Cancel the variable's Edit window; `answer` replies to its unsaved-changes question when one is due. */
export async function closeVariableWindow(page: Page, name: string, answer?: CloseAnswer): Promise<void> {
  await cancelWindow(page, await editWindow(page, name), answer)
}

/** Open a nested level from an entry's expand and return the sheet it adds. */
export async function openNestedEditor(page: Page, expand: Locator): Promise<Locator> {
  return openNewValueSheet(page, () => expand.click(), 'Visual')
}

/** The parts of one list item or map entry; a part the entry does not draw resolves to no element. */
export interface EntryParts {
  /** The entry's grid row. */
  row: Locator
  /** The key's row box (map only). */
  keyBox: Locator
  keyInput: Locator
  /** The value's row box while it is a literal or null (it holds the null button). */
  valueBox: Locator
  valueInput: Locator
  nullChip: Locator
  nullButton: Locator
  /** The {x} value's box while the entry is an expression. */
  exprBox: Locator
  exprToggle: Locator
  expand: Locator
  /** The Type picker, or the read-only pill of a fixed type. */
  typeCell: Locator
  remove: Locator
}

function entryParts(scope: Locator, ids: Record<keyof Omit<EntryParts, 'row' | 'keyBox' | 'valueBox'>, string>): EntryParts {
  const byId = (id: string) => scope.locator(`[data-testid="${id}"]`)
  const nullButton = byId(ids.nullButton)
  const keyInput = byId(ids.keyInput)
  const anchor = scope.locator(
    `[data-testid="${ids.nullButton}"], [data-testid="${ids.exprBox}"], [data-testid="${ids.exprToggle}"]`,
  )
  return {
    row: anchor.first().locator('xpath=ancestor::div[contains(@style, "grid-template-columns")][1]'),
    keyBox: keyInput.locator(`xpath=ancestor::*[@data-slot="input-group"][1]`),
    keyInput,
    valueBox: nullButton.locator(`xpath=ancestor::*[@data-slot="input-group"][1]`),
    valueInput: byId(ids.valueInput),
    nullChip: byId(ids.nullChip),
    nullButton,
    exprBox: byId(ids.exprBox),
    exprToggle: byId(ids.exprToggle),
    expand: byId(ids.expand),
    typeCell: byId(ids.typeCell),
    remove: byId(ids.remove),
  }
}

/** Map entry `index` (0-based) of the map editor inside `scope`. */
export function mapEntry(scope: Locator, index: number): EntryParts {
  return entryParts(scope, {
    keyInput: `map-edit-key-${index}`,
    valueInput: `map-edit-value-${index}`,
    nullChip: `map-edit-null-${index}`,
    nullButton: `map-edit-value-${index}-null`,
    exprBox: `map-expr-value-${index}`,
    exprToggle: `map-expr-toggle-${index}`,
    expand: `map-expand-${index}`,
    typeCell: `map-type-${index}`,
    remove: `map-remove-${index}`,
  })
}

/** List item `index` (0-based) of the list editor inside `scope`; a list has no key. */
export function listItem(scope: Locator, index: number): EntryParts {
  return entryParts(scope, {
    keyInput: `array-no-key-${index}`,
    valueInput: `array-edit-input-${index}`,
    nullChip: `array-edit-null-${index}`,
    nullButton: `array-edit-input-${index}-null`,
    exprBox: `array-expr-value-${index}`,
    exprToggle: `array-expr-toggle-${index}`,
    expand: `array-expand-${index}`,
    typeCell: `array-type-${index}`,
    remove: `array-remove-${index}`,
  })
}

/** The parts of one table cell. */
export interface CellParts {
  box: Locator
  /** The cell's input, true / false selector or null chip. */
  control: Locator
  nullButton: Locator
}

/** Table cell at `row` (0-based) and `column` (0-based) of the table editor inside `scope`. */
export function tableCell(scope: Locator, row: number, column: number): CellParts {
  const id = `table-cell-${row}-${column}`
  const nullButton = scope.locator(`[data-testid="${id}-null"]`)
  return {
    box: nullButton.locator(`xpath=ancestor::*[@data-slot="input-group"][1]`),
    control: scope.locator(`[data-testid="${id}"]`),
    nullButton,
  }
}

/** The parts of one row of the Parts editor. */
export interface PartParts {
  row: Locator
  kind: Locator
  name: Locator
  value: Locator
  source: Locator
  exprBox: Locator
  exprToggle: Locator
  browse: Locator
  remove: Locator
}

/** Part `index` (0-based) of the Parts editor `scope`. */
export function partRow(scope: Locator, index: number): PartParts {
  const byId = (id: string) => scope.locator(`[data-testid="${id}"]`)
  const kind = byId(`part-kind-${index}`)
  return {
    row: kind.locator('xpath=parent::div'),
    kind,
    name: byId(`part-name-${index}`),
    value: byId(`part-value-${index}`),
    source: byId(`part-source-${index}`),
    exprBox: byId(`part-expr-value-${index}`),
    exprToggle: byId(`part-expr-toggle-${index}`),
    browse: byId(`part-browse-${index}`),
    remove: byId(`part-remove-${index}`),
  }
}

/** Every shared {x} toggle inside `scope` (FIELD-1). */
export function expressionToggles(scope: Locator): Locator {
  return scope.locator('[data-slot="expression-toggle"]')
}

/** A header-band label of a list or map editor by its text (`Key`, `#`, `Value`, `Type`), case as written. */
export function headerLabel(scope: Locator, text: string): Locator {
  return scope.locator(`xpath=.//span[not(*) and normalize-space(.)="${text}"]`)
}

/** The row box (`[data-slot="input-group"]`) that holds `inner`. */
export function rowBoxOf(inner: Locator): Locator {
  return inner.locator(`xpath=ancestor-or-self::*[@data-slot="input-group"][1]`)
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** A rendered element's box; fails when it has none. */
export async function rectOf(target: Locator, what: string): Promise<Rect> {
  await expect(target, `${what} shows`).toBeVisible()
  const box = await target.boundingBox()
  expect(box, `${what} has a box`).not.toBeNull()
  return box as Rect
}

/** `inner` lies inside `outer`, edges included, to half a pixel. */
export function expectInside(inner: Rect, outer: Rect, what: string): void {
  const slack = 0.5
  expect(inner.x, `${what}: left edge inside`).toBeGreaterThanOrEqual(outer.x - slack)
  expect(inner.y, `${what}: top edge inside`).toBeGreaterThanOrEqual(outer.y - slack)
  expect(inner.x + inner.width, `${what}: right edge inside`).toBeLessThanOrEqual(outer.x + outer.width + slack)
  expect(inner.y + inner.height, `${what}: bottom edge inside`).toBeLessThanOrEqual(outer.y + outer.height + slack)
}

/** An element's computed background and text color as `#rrggbbaa`, and its raw CSS background. */
export interface ColorLook {
  background: string
  color: string
  cssBackground: string
}

/** The computed colors of `target`; an icon button reads its icon's color. */
export function colorLook(target: Locator): Promise<ColorLook> {
  return target.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d')!
    const hex = (css: string) => {
      ctx.clearRect(0, 0, 1, 1)
      ctx.fillStyle = '#000000'
      ctx.fillStyle = css
      ctx.fillRect(0, 0, 1, 1)
      return `#${[...ctx.getImageData(0, 0, 1, 1).data].map((n) => n.toString(16).padStart(2, '0')).join('')}`
    }
    const icon = el.querySelector('svg') ?? el
    const style = getComputedStyle(el)
    return {
      background: hex(style.backgroundColor),
      color: hex(getComputedStyle(icon).color),
      cssBackground: style.backgroundColor,
    }
  })
}

/** The look of a visually disabled control (opacity 0.5, the not-allowed cursor) that takes no click. */
export async function expectVisuallyDisabled(target: Locator, what: string): Promise<void> {
  await expect(target, `${what} is disabled`).toBeDisabled()
  const look = await target.evaluate((el) => {
    let opacity = 1
    for (let node: Element | null = el; node; node = node.parentElement) opacity *= Number(getComputedStyle(node).opacity)
    return { opacity: Math.round(opacity * 1000) / 1000, cursor: getComputedStyle(el).cursor }
  })
  expect(look, `${what} looks disabled`).toEqual({ opacity: 0.5, cursor: 'not-allowed' })
}

/** Hover `target` for three times the tooltip delay (500 ms) and prove no tooltip opened. */
export async function expectNoTooltipOnHover(page: Page, target: Locator, what: string): Promise<void> {
  await target.hover()
  // Proving a negative: a tooltip would open 500 ms after the pointer settles.
  await page.waitForTimeout(1_500)
  expect(await target.evaluate((el) => el.matches(':hover')), `${what}: the pointer is still on it`).toBe(true)
  await expect(page.locator(OPEN_TOOLTIP), `${what}: no tooltip opens on hover`).toHaveCount(0)
}

/** Run `check` in the theme the page shows, then again after the shell toggle; `check` closes what it opens. */
export async function inBothThemes(
  page: Page,
  check: (theme: 'light' | 'dark') => Promise<void>,
): Promise<void> {
  const first = (await page.locator('html').getAttribute('data-theme')) === 'dark' ? 'dark' : 'light'
  await check(first)
  const second = await toggleTheme(page)
  expect(second, 'the shell toggle switches the theme').not.toBe(first)
  await check(second)
}

/** Park the pointer on the page corner and drop focus, so no hover look, focus look or tooltip remains. */
export async function parkPointer(page: Page): Promise<void> {
  await page.mouse.move(1, 1)
  // A closed sheet hands focus back to its opener, whose tooltip then opens on focus.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  await expect(page.locator(OPEN_TOOLTIP)).toHaveCount(0)
}
