/**
 * V-VMGR-VIRTUALIZED: the Variable Manager list above the virtualization threshold.
 *
 * Design Decisions: VMGR-3 (sort options), VMGR-4 (flat list), VMGR-5 (per-row
 * two-line grid), VMGR-7 (badge order), VMGR-13 (ArrowUp / ArrowDown focus)
 * REQ: REQ-3.1.3.11
 *
 * The panel swaps to a windowed list once it holds more than 50 variables. The
 * windowed branch must be indistinguishable from the plain one: the same row
 * height, the same separator, the same order, the same badges, and every drawn
 * slot carrying its own row rather than an empty box.
 *
 * Pass Criteria:
 * 1. 62 declarations put the panel on the windowed branch, and the window it
 *    uses is the measured panel body, not the first-paint fallback.
 * 2. Every drawn slot holds exactly one row, and the names and values read in
 *    DOM order are the first K entries of the A-Z order, all distinct.
 * 3. Row pitch, row height and the bottom separator are identical in the
 *    windowed branch and in the plain branch, measured on the same variables.
 * 4. Filtering narrows above the threshold, flips the branch when it drops
 *    below it, and reports no match by name.
 * 5. Sorting reorders the window with no scroll at all.
 * 6. Scrolling to the bottom reaches the last name and its value.
 * 7. ArrowDown walks focus from the first row to the last across the whole
 *    list, and ArrowUp walks back, always landing on a drawn row.
 * 8. A variable named only inside a {{ }} marker is Used; one named as literal
 *    text in the same string is not.
 */

import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { importValidateAndNavigate } from '../../helpers/fixture-import'
import { expandVariableManager, variableRow } from '../../helpers/variable-create'

// Production twins in
// frontend/src/features/workbench/common/variables/variable-manager-content/types.ts.
// E2E specs cannot import from frontend/src, so the numbers are restated here.
const VIRTUALIZATION_THRESHOLD_LOCAL = 50
const ROW_PITCH_PX = 63
const FALLBACK_WINDOW_PX = 400

const TOTAL_VARIABLES = 62
const FIRST_PAD = 8
const PAD_MATCHES = 55
const NARROW_MATCHES = 9

const PANEL = '[data-testid="variable-manager-content"]'
const LIST = '[data-testid="virtualized-list"]'
const SPACER = `${LIST} [data-virtualized-spacer]`
const SLOTS = `${LIST} [data-list-item=""]:not([data-placeholder])`
const ROWS = `${PANEL} [aria-label^="Variable "]`
const NAME_CELL = '[data-testid^="variable-name-"]'
const VALUE_CELL = '[data-testid^="variable-value-"]'
const UNUSED_BADGE = '[data-testid^="unused-badge-"]'
const SECRET_BADGE = '[data-testid^="secret-badge-"]'
const EXPR_BADGE = '[data-testid^="expr-badge-"]'
const OUT_BADGE = '[data-testid^="out-badge-"]'
const TYPE_BADGE = '[data-testid^="type-badge-"]'

const NO_MATCH_TEXT = 'No variables match filter'

const DECLARED_NAMES = [
  'vm1_001_owner',
  'vm1_002_suffix',
  'vm1_003_literal',
  'vm1_004_lonely',
  'vm1_005_secret',
  'vm1_006_expr',
  'vm1_007_bound',
]
const DECLARED_VALUES = [
  'ada',
  'notes',
  'never-referenced',
  'never-mentioned',
  '********',
  '41 + 1',
  'unbound',
]

function padName(n: number): string {
  return `vm1_${String(n).padStart(3, '0')}_pad`
}

const EXPECTED_NAMES = [...DECLARED_NAMES]
const EXPECTED_VALUES = [...DECLARED_VALUES]
for (let n = FIRST_PAD; n <= TOTAL_VARIABLES; n++) {
  EXPECTED_NAMES.push(padName(n))
  EXPECTED_VALUES.push(String(n))
}

const FIRST_NAME = EXPECTED_NAMES[0]
const LAST_NAME = EXPECTED_NAMES[TOTAL_VARIABLES - 1]
const LAST_VALUE = EXPECTED_VALUES[TOTAL_VARIABLES - 1]

interface VariableDecl {
  value: unknown
  type: string
  scope: string
  secret?: boolean
  isExpression?: boolean
}

type VirtualizedFixture = Record<string, unknown> & {
  variables: Record<string, VariableDecl>
}

/** The checked-in 7 declarations plus the 55 fillers that cross the threshold. */
function buildFixture(): VirtualizedFixture {
  const raw = fs.readFileSync(path.resolve(__dirname, 'fixture-virtualized.json'), 'utf-8')
  const fixture = JSON.parse(raw) as VirtualizedFixture
  for (let n = FIRST_PAD; n <= TOTAL_VARIABLES; n++) {
    fixture.variables[padName(n)] = { value: n, type: 'integer', scope: 'test' }
  }
  return fixture
}

interface RowMetrics {
  tops: number[]
  heights: string[]
  borders: string[]
}

async function readRowMetrics(page: Page): Promise<RowMetrics> {
  return page.locator(ROWS).evaluateAll((els) => ({
    tops: els.map((el) => el.getBoundingClientRect().top),
    heights: els.map((el) => getComputedStyle(el).height),
    borders: els.map((el) => {
      const style = getComputedStyle(el)
      return `${style.borderBottomWidth}|${style.borderBottomStyle}|${style.borderBottomColor}`
    }),
  }))
}

/** Adjacent top-to-top distances, rounded to 0.01 px so a sub-pixel layout
 *  artifact cannot masquerade as a pitch change. */
function pitchDeltas(tops: number[]): number[] {
  const deltas: number[] = []
  for (let i = 1; i < tops.length; i++) {
    deltas.push(Math.round((tops[i] - tops[i - 1]) * 100) / 100)
  }
  return deltas
}

interface SlotContent {
  rowCount: number
  name: string
  value: string
}

async function readSlots(page: Page): Promise<SlotContent[]> {
  return page.locator(SLOTS).evaluateAll((els) =>
    els.map((el) => ({
      rowCount: el.querySelectorAll('[aria-label^="Variable "]').length,
      name: el.querySelector('[data-testid^="variable-name-"]')?.textContent?.trim() ?? '',
      value: el.querySelector('[data-testid^="variable-value-"]')?.textContent?.trim() ?? '',
    })),
  )
}

async function spacerHeight(page: Page): Promise<string> {
  return page.locator(SPACER).evaluate((el) => getComputedStyle(el).height)
}

async function firstDrawnName(page: Page): Promise<string> {
  return (await page.locator(ROWS).first().locator(NAME_CELL).textContent())?.trim() ?? ''
}

async function setScrollTop(page: Page, position: 'top' | 'bottom'): Promise<void> {
  await page.locator(LIST).evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, position)
}

interface ActiveRowState {
  label: string | null
  isRow: boolean
  inPlaceholder: boolean
  inList: boolean
}

async function activeRowState(page: Page): Promise<ActiveRowState> {
  return page.evaluate(() => {
    const el = document.activeElement
    return {
      label: el ? el.getAttribute('aria-label') : null,
      isRow: el ? el.matches('[aria-label^="Variable "]') : false,
      inPlaceholder: el ? el.closest('[data-placeholder]') !== null : false,
      inList: el ? el.closest('[data-testid="virtualized-list"]') !== null : false,
    }
  })
}

function expectDrawnRow(state: ActiveRowState, name: string): void {
  expect(state.label).toBe(`Variable ${name}`)
  expect(state.isRow).toBe(true)
  expect(state.inPlaceholder).toBe(false)
  expect(state.inList).toBe(true)
}

// The window that renders the next row commits asynchronously, so each press
// waits for focus to land before the next one is sent.
async function pressArrow(page: Page, key: 'ArrowDown' | 'ArrowUp', times: number): Promise<void> {
  for (let i = 0; i < times; i++) {
    const before = (await activeRowState(page)).label
    await page.keyboard.press(key)
    await expect
      .poll(async () => (await activeRowState(page)).label, { timeout: 5_000 })
      .not.toBe(before)
  }
}

async function filterTo(page: Page, needle: string): Promise<void> {
  const clear = page.locator(`${PANEL} button[aria-label="Clear filter"]`)
  if ((await clear.count()) > 0) await clear.click()
  if (needle.length > 0) {
    await page
      .locator(PANEL)
      .getByRole('searchbox', { name: 'Filter variables' })
      .fill(needle)
  }
}

async function sortBy(page: Page, option: 'Name A-Z' | 'Name Z-A' | 'Type'): Promise<void> {
  await page.locator('[data-testid="sort-dropdown"]').click()
  await page.getByRole('option', { name: option, exact: true }).click()
}

test.describe('V-VMGR-VIRTUALIZED: Variable Manager above the virtualization threshold', () => {
  test('the windowed list draws every slot, measures like the plain list, and navigates end to end', async ({
    page,
  }) => {
    const fixture = buildFixture()

    await test.step('STEP 1: the fixture crosses the virtualization threshold', () => {
      expect(Object.keys(fixture.variables)).toHaveLength(TOTAL_VARIABLES)
      expect(TOTAL_VARIABLES).toBeGreaterThan(VIRTUALIZATION_THRESHOLD_LOCAL)
    })

    await importValidateAndNavigate(page, fixture)
    await expandVariableManager(page)

    const list = page.locator(LIST)

    await test.step('STEP 2: the panel is windowed and the window is the measured panel body', async () => {
      await expect(list).toHaveCount(1)
      await expect
        .poll(async () => spacerHeight(page), {
          timeout: 10_000,
          message: 'the spacer must span every declared variable at the fixed row pitch',
        })
        .toBe(`${TOTAL_VARIABLES * ROW_PITCH_PX}px`)

      await expect
        .poll(
          async () =>
            list.evaluate((el) => {
              const parent = el.parentElement
              const wrapper = parent ? parent.getBoundingClientRect().height : -1
              return Math.abs(el.getBoundingClientRect().height - wrapper) < 0.5
            }),
          {
            timeout: 10_000,
            message: 'the windowed list must be exactly as tall as the panel body that measures it',
          },
        )
        .toBe(true)

      const wrapperHeight = await list.evaluate((el) => {
        const parent = el.parentElement
        return parent ? parent.getBoundingClientRect().height : -1
      })
      expect(
        wrapperHeight,
        `measured panel body is ${wrapperHeight}px; it must exceed the ${FALLBACK_WINDOW_PX}px first-paint fallback for this assertion to tell them apart`,
      ).toBeGreaterThan(FALLBACK_WINDOW_PX)
    })

    let drawnCount = 0

    await test.step('STEP 3: every drawn slot draws its own row', async () => {
      const slots = await readSlots(page)
      drawnCount = slots.length
      expect(drawnCount).toBeGreaterThan(1)
      expect(slots.map((s) => s.rowCount)).toEqual(new Array(drawnCount).fill(1))
      expect(slots.map((s) => s.name)).toEqual(EXPECTED_NAMES.slice(0, drawnCount))
      expect(slots.map((s) => s.value)).toEqual(EXPECTED_VALUES.slice(0, drawnCount))
      expect(new Set(slots.map((s) => s.name)).size).toBe(drawnCount)
    })

    await test.step('STEP 4: badges on the first window', async () => {
      await expect(variableRow(page, 'vm1_001_owner').locator(UNUSED_BADGE)).toHaveCount(0)
      await expect(variableRow(page, 'vm1_002_suffix').locator(UNUSED_BADGE)).toHaveCount(0)
      await expect(variableRow(page, 'vm1_003_literal').locator(UNUSED_BADGE)).toHaveText('Unused')
      await expect(variableRow(page, 'vm1_004_lonely').locator(UNUSED_BADGE)).toHaveText('Unused')

      await expect(variableRow(page, 'vm1_005_secret').locator(SECRET_BADGE)).toHaveText('SECRET')
      await expect(variableRow(page, 'vm1_005_secret').locator(VALUE_CELL)).toHaveText('********')

      await expect(variableRow(page, 'vm1_006_expr').locator(EXPR_BADGE)).toHaveText('{x}')
      await expect(variableRow(page, 'vm1_006_expr').locator(TYPE_BADGE)).toHaveText('integer')

      await expect(variableRow(page, 'vm1_007_bound').locator(OUT_BADGE)).toHaveText('OUT')
      await expect(variableRow(page, 'vm1_007_bound').locator(UNUSED_BADGE)).toHaveCount(0)

      await expect(variableRow(page, 'vm1_008_pad').locator(TYPE_BADGE)).toHaveText('integer')
      await expect(variableRow(page, 'vm1_008_pad').locator(UNUSED_BADGE)).toHaveText('Unused')
    })

    let virtualizedHeight = ''
    let virtualizedBorder = ''

    await test.step('STEP 5: row pitch and separators in the windowed branch', async () => {
      const metrics = await readRowMetrics(page)
      expect(metrics.tops.length).toBeGreaterThan(1)

      const deltas = pitchDeltas(metrics.tops)
      expect(deltas).toEqual(new Array(deltas.length).fill(ROW_PITCH_PX))
      expect(metrics.heights).toEqual(new Array(metrics.heights.length).fill(`${ROW_PITCH_PX}px`))
      expect(metrics.borders).toEqual(new Array(metrics.borders.length).fill(metrics.borders[0]))

      virtualizedHeight = metrics.heights[0]
      virtualizedBorder = metrics.borders[0]
      expect(virtualizedBorder.split('|')[0]).toBe('1px')
      expect(virtualizedBorder.split('|')[1]).toBe('solid')
    })

    await test.step('STEP 6: the plain branch below the threshold measures identically', async () => {
      await filterTo(page, 'vm1_00')
      await expect(list).toHaveCount(0)
      await expect(page.locator(ROWS)).toHaveCount(NARROW_MATCHES)

      const metrics = await readRowMetrics(page)
      expect(metrics.tops).toHaveLength(NARROW_MATCHES)
      expect(pitchDeltas(metrics.tops)).toEqual(new Array(NARROW_MATCHES - 1).fill(ROW_PITCH_PX))
      expect(metrics.heights).toEqual(new Array(NARROW_MATCHES).fill(virtualizedHeight))
      expect(metrics.borders).toEqual(new Array(NARROW_MATCHES).fill(virtualizedBorder))
    })

    await test.step('STEP 7: the filter still narrows above the threshold', async () => {
      await filterTo(page, '_pad')
      await expect(list).toHaveCount(1)
      await expect
        .poll(async () => spacerHeight(page), { timeout: 10_000 })
        .toBe(`${PAD_MATCHES * ROW_PITCH_PX}px`)
      await expect
        .poll(async () => firstDrawnName(page), { timeout: 10_000 })
        .toBe(padName(FIRST_PAD))
      await expect(variableRow(page, FIRST_NAME)).toHaveCount(0)
    })

    await test.step('STEP 8: a filter that matches nothing', async () => {
      await filterTo(page, 'zzz')
      await expect(page.locator(PANEL).getByText(NO_MATCH_TEXT, { exact: true })).toBeVisible()
      await expect(list).toHaveCount(0)
    })

    await test.step('STEP 9: sort still applies above the threshold', async () => {
      await filterTo(page, '')
      await expect(list).toHaveCount(1)
      await expect
        .poll(async () => spacerHeight(page), { timeout: 10_000 })
        .toBe(`${TOTAL_VARIABLES * ROW_PITCH_PX}px`)

      await sortBy(page, 'Name Z-A')
      await expect
        .poll(async () => firstDrawnName(page), { timeout: 10_000 })
        .toBe(LAST_NAME)
      expect(await spacerHeight(page)).toBe(`${TOTAL_VARIABLES * ROW_PITCH_PX}px`)

      await sortBy(page, 'Type')
      await expect
        .poll(async () => firstDrawnName(page), { timeout: 10_000 })
        .toBe('vm1_006_expr')

      await sortBy(page, 'Name A-Z')
      await expect
        .poll(async () => firstDrawnName(page), { timeout: 10_000 })
        .toBe(FIRST_NAME)
    })

    await test.step('STEP 10: scrolling reaches the last name', async () => {
      await setScrollTop(page, 'top')
      await expect(variableRow(page, LAST_NAME)).toHaveCount(0)

      await setScrollTop(page, 'bottom')
      await expect(variableRow(page, LAST_NAME)).toBeVisible()
      await expect(variableRow(page, LAST_NAME).locator(NAME_CELL)).toHaveText(LAST_NAME)
      await expect(variableRow(page, LAST_NAME).locator(VALUE_CELL)).toHaveText(LAST_VALUE)
    })

    await test.step('STEP 11: keyboard navigation walks the whole list', async () => {
      await setScrollTop(page, 'top')
      await expect(variableRow(page, FIRST_NAME)).toBeVisible()
      await variableRow(page, FIRST_NAME).focus()
      expectDrawnRow(await activeRowState(page), FIRST_NAME)

      await pressArrow(page, 'ArrowDown', 13)
      expectDrawnRow(await activeRowState(page), padName(14))

      await pressArrow(page, 'ArrowDown', TOTAL_VARIABLES - 1 - 13)
      expectDrawnRow(await activeRowState(page), LAST_NAME)

      await pressArrow(page, 'ArrowUp', 5)
      expectDrawnRow(await activeRowState(page), padName(57))
    })
  })
})
