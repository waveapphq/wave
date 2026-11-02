/**
 * V-ENTRY-LOOK-ADVISORY: the unsecured-credential advisory on the Headers one-line field, as the map editor shows it,
 * and a cut Headers line that ends clear of it
 * Design Decisions: FIELD-1, HTTP-4, SECFLD-2
 * REQ: REQ-3.1.1.5, REQ-3.1.3.18
 *
 * Phase: functional-workflow. Each test imports `fixture-look-advisory.json` under a `zz-11541-s6a-` name, proves it
 * validates with zero errors and deletes it afterwards. Every check runs in both themes.
 *
 * Pass Criteria:
 * 1. The Headers one-line field holding `{"Authorization": "Bearer abc"}` shows the amber `Unsecured credential`
 *    mark inside the field at its right end.
 * 2. The map editor's Authorization entry shows the same mark inside its value box: the same size, the same amber
 *    and the same tooltip text as the field's.
 * 3. A Headers line too long for the field is cut with an ellipsis, and the text ends left of the mark's left edge.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { deleteTest, readFixture } from '../../helpers/element-types'
import { openBlockSheet } from '../../helpers/workbench'
import { paramRow } from '../../helpers/config-sheet'
import { closeValueEditor } from '../../helpers/variable-create'
import { waitForTooltipVisible } from '../../helpers/tooltip-wait'
import {
  closeBlockSheet,
  colorLook,
  expectInside,
  inBothThemes,
  mapEntry,
  openBlockEditor,
  parkPointer,
  rectOf,
} from '../../helpers/entry-editors'

const FIXTURE = 'fixture-look-advisory.json'
const SHORT = 'a88256e5-269b-4dde-8edc-156fc59cb292'
const LONG = 'f2e9909b-2059-4e11-9bd0-17d49077ebb3'

const MARK = '[aria-label="Unsecured credential"]'
const OPEN_TOOLTIP = '[data-slot="tooltip-content"]:not([data-state="closed"]) [role="tooltip"]'

const headersBox = (sheet: Locator): Locator => paramRow(sheet, 'headers').locator('[data-slot="input-group"]').first()
const headersLine = (sheet: Locator): Locator => headersBox(sheet).locator('input').first()

/** An amber hue (about 38 degrees, the warning color), fully opaque and saturated. */
function expectAmber(hex: string, what: string): void {
  const [r, g, b, a] = [1, 3, 5, 7].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const hue = max === r ? (60 * ((g - b) / (max - min)) + 360) % 360 : max === g ? 60 * ((b - r) / (max - min)) + 120 : 60 * ((r - g) / (max - min)) + 240
  expect(a, `${what} is opaque (${hex})`).toBe(1)
  expect(max - min, `${what} is a saturated color (${hex})`).toBeGreaterThan(0.5)
  expect(hue, `${what} is amber (${hex}, hue ${hue.toFixed(1)})`).toBeGreaterThanOrEqual(30)
  expect(hue).toBeLessThanOrEqual(50)
}

/** The mark's icon color and the tooltip it opens on hover. */
async function markReading(page: Page, mark: Locator, what: string): Promise<{ color: string; tooltip: string }> {
  const { color } = await colorLook(mark)
  await mark.hover()
  await waitForTooltipVisible(page, what, 5_000)
  const tooltip = ((await page.locator(OPEN_TOOLTIP).textContent()) ?? '').trim()
  await parkPointer(page)
  return { color, tooltip }
}

async function checkShortLine(page: Page): Promise<void> {
  const sheet = await openBlockSheet(page, SHORT)
  await expect(headersLine(sheet), 'the Headers line holds the plain Authorization header').toHaveValue(
    /^\{"Authorization": ?"Bearer abc"\}$/,
  )
  const fieldMark = paramRow(sheet, 'headers').locator(MARK)
  const box = await rectOf(headersBox(sheet), 'Headers field')
  const mark = await rectOf(fieldMark, 'Headers field advisory')
  expectInside(mark, box, 'the advisory lies inside the Headers field')
  const rightGap = box.x + box.width - (mark.x + mark.width)
  expect(rightGap, `the advisory sits at the field's right end (gap ${rightGap})`).toBeLessThanOrEqual(10)
  const onField = await markReading(page, fieldMark, 'Headers field advisory')
  expectAmber(onField.color, 'the field advisory')

  const editor = await openBlockEditor(page, sheet, 'headers')
  const entry = mapEntry(editor, 0)
  await expect(entry.keyInput).toHaveValue('Authorization')
  const editorMark = entry.valueBox.locator(MARK)
  expectInside(await rectOf(editorMark, 'map entry advisory'), await rectOf(entry.valueBox, 'map value box'), 'the map editor advisory lies inside the value box')
  const inEditor = await markReading(page, editorMark, 'map editor advisory')
  expect(onField, 'the field shows the advisory the map editor shows').toEqual(inEditor)
  const sizes = [await rectOf(fieldMark, 'field mark'), await rectOf(editorMark, 'editor mark')]
  expect(Math.abs(sizes[0].width - sizes[1].width), 'one mark size').toBeLessThanOrEqual(0.5)
  expect(Math.abs(sizes[0].height - sizes[1].height), 'one mark size').toBeLessThanOrEqual(0.5)
  await closeValueEditor(page, editor)
  await closeBlockSheet(sheet)
}

async function checkCutLine(page: Page): Promise<void> {
  const sheet = await openBlockSheet(page, LONG)
  const line = headersLine(sheet)
  await expect(line).toHaveValue(/^\{"Authorization": ?"Bearer abcdef/)
  const fieldMark = paramRow(sheet, 'headers').locator(MARK)
  const mark = await rectOf(fieldMark, 'cut Headers line advisory')
  const text = await line.evaluate((el) => {
    const input = el as HTMLInputElement
    const rect = input.getBoundingClientRect()
    const style = getComputedStyle(input)
    return {
      cut: input.scrollWidth > input.clientWidth,
      overflow: style.textOverflow,
      right: rect.right - Number.parseFloat(style.paddingRight) - Number.parseFloat(style.borderRightWidth),
    }
  })
  expect(text.cut, 'the long Headers line is cut').toBe(true)
  expect(text.overflow, 'the cut line ends in an ellipsis').toBe('ellipsis')
  expect(text.right, `the line's text ends (${text.right}) left of the mark (${mark.x})`).toBeLessThan(mark.x)
  await closeBlockSheet(sheet)
}

test.describe('V-ENTRY-LOOK-ADVISORY: the unsecured-credential advisory on the Headers field', () => {
  test('the Headers line shows the map editor advisory, and a cut line ends clear of it', async ({ page }) => {
    let testId = ''
    try {
      testId = await importValidateAndNavigate(page, readFixture(__dirname, FIXTURE))
      await inBothThemes(page, async () => {
        await checkShortLine(page)
        await checkCutLine(page)
      })
    } finally {
      if (testId) await deleteTest(page.request, testId)
    }
  })
})
