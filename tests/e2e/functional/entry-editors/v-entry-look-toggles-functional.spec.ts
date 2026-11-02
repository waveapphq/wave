/**
 * V-ENTRY-LOOK-TOGGLES: every {x} in WAVE is the one shared toggle, 32 px square, pressed in the pressed null
 * button's look, with no hover tooltip on an entry {x}
 * Design Decisions: FIELD-1, FIELD-5, FIELD-6, FIELD-13
 * REQ: REQ-3.1.1.5
 *
 * Phase: functional-workflow. The test imports `fixture-look-toggles.json` under a `zz-11541-s6a-` name, proves it
 * validates with zero errors and deletes it afterwards. Every surface holds its {x} pressed from the stored Test.
 *
 * Pass Criteria (each in both themes):
 * 1. Every button named `... expression mode` on each surface carries `data-slot="expression-toggle"`: the Block row
 *    (HTTP URL), the map editor (Headers), the list editor (Retryable Codes), the Parts editor, the JSON and XML
 *    query rows, the Variable Setter row, the Assert reference and the CSV filter reference.
 * 2. Each of those {x} toggles is 32 x 32 px and reads pressed.
 * 3. With the pointer away, a pressed {x} has the same computed background and icon color as the pressed null button
 *    of the Headers editor's null entry with the pointer away.
 * 4. Under the pointer, a pressed {x} has the same computed background and icon color as that pressed null button
 *    under the pointer, and stays pressed.
 * 5. Hovering an entry {x} (map, list, Parts) opens no tooltip.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, readFixture } from '../../helpers/element-types'
import { openBlockSheet } from '../../helpers/workbench'
import { exprToggle } from '../../helpers/config-sheet'
import { closeValueEditor } from '../../helpers/variable-create'
import {
  closeBlockSheet,
  colorLook,
  expandGroup,
  expectNoTooltipOnHover,
  inBothThemes,
  listItem,
  mapEntry,
  openBlockEditor,
  openPartsEditor,
  parkPointer,
  partRow,
  rectOf,
  type ColorLook,
} from '../../helpers/entry-editors'

const FIXTURE = 'fixture-look-toggles.json'
const NODE = {
  http: 'ae1578e9-3352-4050-b003-463b82a70280',
  json: 'b7db8b8b-88bb-4bd3-aacd-4603ef7f6a79',
  xml: '7cd15f08-9f42-4330-93b4-31b9692ca9be',
  setter: '6777bcd1-3301-4c57-b38e-285461a6a9b1',
  assert: '63868510-1a2d-4b74-8ca2-050b9be463ec',
  csv: 'cf50cb39-3b29-4ae4-aadb-3bbc84582767',
} as const

const TOGGLE_PX = 32

/** A look read twice in a row the same, so no color transition is caught half way. */
async function settledLook(target: Locator): Promise<ColorLook> {
  let last = await colorLook(target)
  await expect
    .poll(
      async () => {
        const next = await colorLook(target)
        const same = JSON.stringify(next) === JSON.stringify(last)
        last = next
        return same
      },
      { message: 'the colors settle', intervals: [200], timeout: 5_000 },
    )
    .toBe(true)
  return last
}

/** Every button named as an {x} on `scope` is the shared toggle (FIELD-1). */
async function expectEveryToggleShared(scope: Locator, what: string): Promise<void> {
  const named = scope.getByRole('button', { name: /expression mode/i })
  const count = await named.count()
  expect(count, `${what}: the surface draws an {x}`).toBeGreaterThan(0)
  for (let index = 0; index < count; index += 1) {
    await expect(named.nth(index), `${what}: {x} ${index} is the shared toggle`).toHaveAttribute(
      'data-slot',
      'expression-toggle',
    )
  }
}

/** The pressed null button's look with the pointer away and under the pointer. */
interface PressedNullLook {
  rest: ColorLook
  hovered: ColorLook
}

/** Hold the pointer on `target` and read its look once settled. */
async function hoveredLook(target: Locator, what: string): Promise<ColorLook> {
  await target.hover()
  await expect.poll(() => target.evaluate((el) => el.matches(':hover')), { message: `${what} is under the pointer` }).toBe(true)
  return settledLook(target)
}

/** One pressed {x}: the shared toggle, 32 px square, the pressed null button's look at rest and under the pointer. */
async function expectPressedToggle(
  page: Page,
  toggle: Locator,
  pressedNull: PressedNullLook,
  what: string,
  entry: boolean,
): Promise<void> {
  await toggle.scrollIntoViewIfNeeded()
  await expect(toggle, `${what} is the shared toggle`).toHaveAttribute('data-slot', 'expression-toggle')
  await expect(toggle, `${what} reads pressed`).toHaveAttribute('aria-pressed', 'true')
  const box = await rectOf(toggle, what)
  expect(Math.abs(box.width - TOGGLE_PX), `${what} is 32 px wide (${box.width})`).toBeLessThanOrEqual(0.5)
  expect(Math.abs(box.height - TOGGLE_PX), `${what} is 32 px tall (${box.height})`).toBeLessThanOrEqual(0.5)

  await parkPointer(page)
  const rest = await settledLook(toggle)
  expect(rest.background, `${what}: the pressed background is the pressed null button's`).toBe(pressedNull.rest.background)
  expect(rest.color, `${what}: the pressed icon color is the pressed null button's`).toBe(pressedNull.rest.color)

  if (entry) await expectNoTooltipOnHover(page, toggle, what)
  const hovered = await hoveredLook(toggle, what)
  expect(hovered.background, `${what}: under the pointer the background is the pressed null button's under the pointer`).toBe(
    pressedNull.hovered.background,
  )
  expect(hovered.color, `${what}: under the pointer the icon color is the pressed null button's under the pointer`).toBe(
    pressedNull.hovered.color,
  )
  await expect(toggle, `${what}: the pointer leaves it pressed`).toHaveAttribute('data-state', 'on')
  await parkPointer(page)
}

/** The HTTP Block: the pressed null button of Headers' null entry, then the Block row, map, list and Parts {x}. */
async function checkHttpBlock(page: Page): Promise<PressedNullLook> {
  const sheet = await openBlockSheet(page, NODE.http)
  const headers = await openBlockEditor(page, sheet, 'headers')
  await expect(mapEntry(headers, 1).keyInput).toHaveValue('X-Null')
  const nullButton = mapEntry(headers, 1).nullButton
  await expect(nullButton, 'the reference null button is pressed').toHaveAttribute('aria-pressed', 'true')
  await parkPointer(page)
  const rest = await settledLook(nullButton)
  const pressedNull = { rest, hovered: await hoveredLook(nullButton, 'the reference null button') }
  await parkPointer(page)
  await expectEveryToggleShared(headers, 'map editor')
  await expectPressedToggle(page, mapEntry(headers, 0).exprToggle, pressedNull, 'map entry {x}', true)
  await closeValueEditor(page, headers)

  await expectEveryToggleShared(sheet, 'HTTP Block rows')
  await expectPressedToggle(page, exprToggle(sheet, 'url'), pressedNull, 'Block row {x} (URL)', false)

  await expandGroup(sheet, 'Timeouts & Retries')
  const codes = await openBlockEditor(page, sheet, 'retryable_status_codes')
  await expectEveryToggleShared(codes, 'list editor')
  await expectPressedToggle(page, listItem(codes, 0).exprToggle, pressedNull, 'list item {x}', true)
  await closeValueEditor(page, codes)

  await expandGroup(sheet, 'Body')
  const parts = await openPartsEditor(page, sheet)
  await expectEveryToggleShared(parts, 'Parts editor')
  await expectPressedToggle(page, partRow(parts, 0).exprToggle, pressedNull, 'Parts {x}', true)
  await parts.locator('[data-testid="parts-editor-cancel-button"]').click()
  await expect(parts).toBeHidden()
  await closeBlockSheet(sheet)
  return pressedNull
}

/** A control or parser Block whose {x} sits in its own editor in the config sheet. */
async function checkBlockToggle(
  page: Page,
  node: string,
  toggleId: string,
  pressedNull: PressedNullLook,
  what: string,
  open?: (sheet: Locator) => Promise<void>,
): Promise<void> {
  const sheet = await openBlockSheet(page, node)
  if (open) await open(sheet)
  await expectEveryToggleShared(sheet, what)
  await expectPressedToggle(page, sheet.locator(`[data-testid="${toggleId}"]`), pressedNull, `${what} {x}`, false)
  await closeBlockSheet(sheet)
}

test.describe('V-ENTRY-LOOK-TOGGLES: one shared {x} toggle in the pressed null button look', () => {
  test('every {x} surface draws the shared 32 px toggle, pressed like the null button, at rest and under the pointer', async ({
    page,
  }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        const pressedNull = await checkHttpBlock(page)
        await checkBlockToggle(page, NODE.json, 'json-query-expr-toggle-0', pressedNull, 'JSON query row')
        await checkBlockToggle(page, NODE.xml, 'xml-query-expr-toggle-0', pressedNull, 'XML query row')
        await checkBlockToggle(page, NODE.setter, 'varset-expression-toggle-0', pressedNull, 'Variable Setter row')
        await checkBlockToggle(page, NODE.assert, 'assert-expr-toggle-0', pressedNull, 'Assert reference')
        await checkBlockToggle(
          page,
          NODE.csv,
          'filter-condition-expr-toggle-look-filter-1-cond-1',
          pressedNull,
          'CSV filter reference',
          async (sheet) => {
            const trigger = sheet.locator('[data-testid="csv-filters-section-trigger"]')
            if ((await trigger.getAttribute('data-state')) !== 'open') await trigger.click()
            await expect(trigger).toHaveAttribute('data-state', 'open')
          },
        )
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })
})
