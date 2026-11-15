/**
 * V-CTRL-PARALLEL-03: Parallel lane rows
 * Design Decisions: PARALLEL-3, PARALLEL-5, FIELD-1, FIELD-16, FIELDERR-1, FIELDERR-2
 * REQ: REQ-3.1.1.3, REQ-3.1.1.5, REQ-3.2.3.7
 * Phase: no-data
 *
 * Seed (API, POST /tests): per theme two `zz-ctrl-fields-` Tests, validated with zero errors and deleted afterwards.
 * `lane-rows`: the Parallel `Check lanes` with the lanes `api` (5000), `database` ({x} `lane_limit * 2`) and `cache`
 * (no limit), and the Test variable `lane_limit`. `lanes`: the Parallel `Run checks` with the Section Time Limit
 * 60000, the lanes `ingest` (30000), `probe` (5000) and `drain` (15000) and JOIN MODE `First to finish`. Every edit
 * is made in the open window and never saved.
 *
 * Pass Criteria (in both themes):
 * 1. The Parallel window opens 880 px wide.
 * 2. Each lane name box fills the row between its badge and its time limit, at most 201 px (the If/Else name
 *    width): 199 px beside a 72 px badge, and the row ends at the card's 12 px padding; it is 40 px tall with
 *    radius 4 and has no {x}.
 * 3. Each lane time limit box is 357 x 36 (the Variable Setter value box) with radius 8, in plain and in {x} mode,
 *    and every box ends at the same x; a number takes the integer color.
 * 4. The expand sits in its own 32 px column 8 px right of the box; a plain lane keeps that column empty.
 * 5. The {x} toggle sits 8 px right of the expand column, at the same x on every lane, and stays there when a lane
 *    switches to {x}.
 * 6. An {x} lane shows `lane_limit * 2` whole, with no scrollbar in its box.
 * 7. The Name and Time limit (ms) headers start at their boxes' left edges; 32 px spacers sit over the expand and
 *    {x} columns, then a 64 px one over the move and delete buttons.
 * 8. The Section Time Limit row is a table row as before: (i), `Section Time Limit`, `Integer`, `60000` in the
 *    integer color, an empty expand column and {x}.
 * 9. JOIN MODE shows `Wait for all` and `First to finish`, with `First to finish` checked.
 * 10. `probe` set to `0`: the box takes the destructive border, `0` keeps the integer color,
 *     `Time Limit must be at least 1` sits 4 px under the box, starting at it, whole; the card head grows 20 px;
 *     Save is disabled with `Save is disabled: the settings have errors`.
 * 11. `+ Branch` adds a lane whose box is empty with no placeholder text; pressing its {x} switches with no
 *     question and leaves the {x} at the same x as on the other lanes.
 * 12. A screenshot of the window in each theme is attached.
 */

import { test, expect, type Locator, type Page } from '../../helpers/playwright-fixtures'
import { elementColor, exprToggle, paramRow, resolvedColor, settingsNote } from '../../helpers/config-sheet'
import { openTest } from '../../helpers/fn-seed'
import { discardBlockSheet } from '../../helpers/number-entry'
import { toggleTheme } from '../../helpers/theme'
import { cellBox, cellError, cellInput, expandButton, switchWarning } from '../../helpers/value-field'
import { configSheet } from '../../helpers/workbench'
import {
  LANE_EXPRESSION,
  LANE_ROWS,
  LANE_ROWS_ID,
  LANE_ROWS_LABEL,
  RUN_CHECKS_ID,
  RUN_CHECKS_LABEL,
  RUN_CHECKS_LANES,
  THEMES,
  WIDE_WINDOW,
  attachWindow,
  bottom,
  deleteControlTest,
  expectMessageLook,
  near,
  openControlWindow,
  rectOf,
  right,
  seedControlTest,
  styleOf,
  type Rect,
} from './control-fields-seed'

const EXPRESSION_LANE = 'branch_2'
const NAME_CAP = 201
// The badge text follows the font, so the name gives up what the badge takes: 199 px beside a 72 px badge.
const NAME_PLUS_BADGE = 271
const CARD_PADDING = 12
const BOX_WIDTH = 357
const ICON_COLUMN = 32
const TAIL_COLUMN = 64
const GAP = 8
const MESSAGE_GAP = 4
const GROWTH = 20
const SAVE_NOTE = 'Save is disabled: the settings have errors'
const NEW_LANE = 'branch_4'

const laneHeader = (sheet: Locator, lane: string) => sheet.getByTestId(`parallel-branch-header-${lane}`)
const nameBox = (sheet: Locator, lane: string) => sheet.getByTestId(`parallel-branch-label-${lane}`)
const limitToggle = (sheet: Locator, lane: string) => sheet.getByTestId(`parallel-branch-limit-toggle-${lane}`)
const limitStem = (lane: string) => `parallel-branch-limit-${lane}`

/** The bordered time limit box: the number box's group in plain mode, the expression box in {x} mode. */
const limitBox = (sheet: Locator, lane: string) => cellBox(sheet, limitStem(lane))

async function openWindow(page: Page, testId: string, theme: string, blockId: string, label: string): Promise<Locator> {
  await openTest(page, testId)
  if (theme === 'light') expect(await toggleTheme(page)).toBe('light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  const sheet = await openControlWindow(page, blockId, label)
  await expect(sheet.getByTestId('parallel-branch-editor')).toBeVisible()
  near((await rectOf(configSheet(page), 'window')).width, WIDE_WINDOW, 'window width')
  return sheet
}

/** Criterion 2: the name box fills the row up to the If/Else name width. */
async function expectNameBox(sheet: Locator, lane: string): Promise<void> {
  const badge = await rectOf(sheet.getByTestId(`parallel-branch-badge-${lane}`), `${lane} badge`)
  const name = await rectOf(nameBox(sheet, lane), `${lane} name`)
  const box = await rectOf(limitBox(sheet, lane), `${lane} box`)
  const remove = await rectOf(sheet.getByTestId(`parallel-branch-delete-${lane}`), `${lane} delete`)
  const header = await rectOf(laneHeader(sheet, lane), `${lane} card head`)
  const widths = `name ${name.width}, badge ${badge.width}`
  expect.soft(name.width, `${lane} ${widths}`).toBeLessThanOrEqual(NAME_CAP + 0.5)
  near(name.width + badge.width, NAME_PLUS_BADGE, `${lane} ${widths}`)
  near(name.x - right(badge), GAP, `${lane} badge to name`)
  near(box.x - right(name), GAP, `${lane} name to box`)
  near(right(header) - right(remove), CARD_PADDING, `${lane} delete to card edge`)
  near(name.height, 40, `${lane} name height`)
  expect.soft(await styleOf(nameBox(sheet, lane), 'border-top-left-radius'), `${lane} name radius`).toBe('4px')
  await expect.soft(laneHeader(sheet, lane).locator('[data-slot="expression-toggle"]'), `${lane}: only the limit has {x}`).toHaveCount(1)
}

/** Criteria 3 to 5 on every lane; returns the {x} x positions. */
async function expectLimitColumns(sheet: Locator, lanes: readonly string[], expressionLanes: readonly string[]): Promise<number[]> {
  const boxRights: number[] = []
  const toggleXs: number[] = []
  for (const lane of lanes) {
    const boxLocator = limitBox(sheet, lane)
    const box = await rectOf(boxLocator, `${lane} box`)
    const toggle = await rectOf(limitToggle(sheet, lane), `${lane} {x}`)
    near(box.width, BOX_WIDTH, `${lane} time limit box width`)
    near(box.height, 36, `${lane} time limit box height`)
    expect.soft(await styleOf(boxLocator, 'border-top-left-radius'), `${lane} box radius`).toBe('8px')
    boxRights.push(right(box))
    toggleXs.push(toggle.x)
    near(toggle.width, ICON_COLUMN, `${lane} {x} width`)
    // The 32 px expand column sits between the box and its {x}, filled or empty.
    near(toggle.x - right(box), GAP + ICON_COLUMN + GAP, `${lane} box to {x}`)
    const expand = expandButton(sheet, limitStem(lane))
    if (expressionLanes.includes(lane)) {
      const expandBox = await rectOf(expand, `${lane} expand`)
      near(expandBox.width, ICON_COLUMN, `${lane} expand column width`)
      near(expandBox.x - right(box), GAP, `${lane} box to expand`)
    } else {
      await expect.soft(expand, `${lane} draws no expand`).toHaveCount(0)
    }
  }
  for (const [index, lane] of lanes.entries()) {
    near(boxRights[index], boxRights[0], `${lane} box right edge`)
    near(toggleXs[index], toggleXs[0], `${lane} {x} x`)
  }
  return toggleXs
}

/** Criterion 7: the column headers over their boxes, and the spacers over the icon and button columns. */
async function expectColumnHeaders(sheet: Locator, lane: string): Promise<void> {
  const columns = sheet.getByTestId('parallel-branch-columns')
  const nameHead = await rectOf(columns.getByText('Name', { exact: true }), 'Name header')
  const limitHead = await rectOf(columns.getByText('Time limit (ms)', { exact: true }), 'Time limit header')
  const name = await rectOf(nameBox(sheet, lane), `${lane} name`)
  const box = await rectOf(limitBox(sheet, lane), `${lane} box`)
  const toggle = await rectOf(limitToggle(sheet, lane), `${lane} {x}`)
  near(nameHead.x, name.x, 'Name header x')
  near(limitHead.x, box.x, 'Time limit header x')
  // The last three header cells are the spacers.
  const cells = columns.locator(':scope > *')
  const count = await cells.count()
  const [expandSpacer, toggleSpacer, tailSpacer] = [
    await rectOf(cells.nth(count - 3), 'expand spacer'),
    await rectOf(cells.nth(count - 2), '{x} spacer'),
    await rectOf(cells.nth(count - 1), 'tail spacer'),
  ]
  near(expandSpacer.width, ICON_COLUMN, 'spacer over the expand column')
  near(expandSpacer.x, right(box) + GAP, 'spacer over the expand column x')
  near(toggleSpacer.width, ICON_COLUMN, 'spacer over the {x} column')
  near(toggleSpacer.x, toggle.x, 'spacer over the {x} column x')
  near(tailSpacer.width, TAIL_COLUMN, 'spacer over the move and delete buttons')
}

/** Criterion 6: the {x} lane shows its expression whole. */
async function expectWholeExpression(sheet: Locator, lane: string): Promise<void> {
  const box = cellInput(sheet, limitStem(lane))
  await expect(box.locator('.cm-content')).toHaveText(LANE_EXPRESSION)
  const fit = await box.evaluate((el) => {
    const scroller = el.querySelector('.cm-scroller') as HTMLElement
    const line = el.querySelector('.cm-line') as HTMLElement
    const range = document.createRange()
    range.selectNodeContents(line)
    const text = range.getBoundingClientRect()
    const frame = scroller.getBoundingClientRect()
    return {
      scrollWidth: scroller.scrollWidth,
      clientWidth: scroller.clientWidth,
      scrollbar: scroller.offsetHeight - scroller.clientHeight,
      textRight: text.right,
      frameRight: frame.right,
    }
  })
  expect.soft(fit.scrollWidth, `scroller ${JSON.stringify(fit)}`).toBeLessThanOrEqual(fit.clientWidth)
  expect.soft(fit.scrollbar, 'horizontal scrollbar height').toBe(0)
  expect.soft(fit.textRight, 'expression ends inside the box').toBeLessThanOrEqual(fit.frameRight)
}

/** Criterion 8: the Section Time Limit table row. */
async function expectSectionLimit(page: Page, sheet: Locator): Promise<void> {
  const row = paramRow(sheet, 'time_limit')
  await expect(row.locator('td:nth-child(1) svg.lucide-info'), 'Section Time Limit has its (i)').toHaveCount(1)
  await expect(row.locator('td:nth-child(2)')).toContainText('Section Time Limit')
  await expect(row.locator('td:nth-child(3) span')).toHaveText('Integer', { useInnerText: true })
  const input = sheet.getByTestId('param-input-time_limit')
  await expect(input).toHaveValue('60000')
  expect.soft(await elementColor(input, 'color'), '60000 in the integer color').toBe(
    await resolvedColor(page, 'var(--color-violet-400)'),
  )
  await expect.soft(expandButton(sheet, 'time_limit'), 'a number has no expand').toHaveCount(0)
  await expect.soft(exprToggle(sheet, 'time_limit')).toHaveAttribute('aria-pressed', 'false')
  const box = await rectOf(cellBox(sheet, 'time_limit'), 'Section Time Limit box')
  const toggle = await rectOf(exprToggle(sheet, 'time_limit'), 'Section Time Limit {x}')
  near(toggle.x - right(box), GAP + ICON_COLUMN + GAP, 'an empty expand column before {x}')
}

/** Criterion 9: JOIN MODE as before, `First to finish` checked. */
async function expectJoinMode(sheet: Locator): Promise<void> {
  await expect(sheet.getByRole('heading', { name: /join mode/i })).toHaveClass(/uppercase/)
  await expect(sheet.locator('label[for="join-mode-all"]')).toHaveText('Wait for all')
  await expect(sheet.locator('label[for="join-mode-first"]')).toHaveText('First to finish')
  await expect(sheet.locator('#join-mode-all')).toHaveAttribute('data-state', 'unchecked')
  await expect(sheet.locator('#join-mode-first')).toHaveAttribute('data-state', 'checked')
  const all = await rectOf(sheet.locator('#join-mode-all'), 'Wait for all')
  const first = await rectOf(sheet.locator('#join-mode-first'), 'First to finish')
  expect.soft(all.y, 'Wait for all sits above First to finish').toBeLessThan(first.y)
}

/** Criterion 10: a lane limit of 0, built in the window. */
async function expectZeroLimit(page: Page, sheet: Locator): Promise<void> {
  const lane = RUN_CHECKS_LANES[1].id
  const destructive = await resolvedColor(page, 'var(--destructive)')
  const headBefore = await rectOf(laneHeader(sheet, lane), 'probe head before')
  const input = cellInput(sheet, limitStem(lane))
  await input.fill('0')
  await sheet.getByTestId('element-description-input').focus()
  await expect(input).toHaveValue('0')

  const message = cellError(sheet, limitStem(lane))
  await expect(message).toHaveText('Time Limit must be at least 1')
  await expectMessageLook(message, 'Time Limit must be at least 1')
  expect.soft(await elementColor(message, 'color'), 'the message is destructive').toBe(destructive)
  const box: Rect = await rectOf(limitBox(sheet, lane), 'probe box')
  const text = await rectOf(message, 'Time Limit must be at least 1')
  near(text.y, bottom(box) + MESSAGE_GAP, 'the message sits 4 px under the box')
  near(text.x, box.x, 'the message starts at the box')
  expect.soft(await elementColor(limitBox(sheet, lane), 'borderTopColor'), 'the box is red').toBe(destructive)
  expect.soft(await elementColor(input, 'color'), '0 keeps the integer color').toBe(
    await resolvedColor(page, 'var(--color-violet-400)'),
  )
  near((await rectOf(laneHeader(sheet, lane), 'probe head after')).height, headBefore.height + GROWTH, 'the card head grows 20 px')

  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeDisabled()
  await expect(settingsNote(sheet)).toHaveText(SAVE_NOTE)
}

/** Criterion 11: a new lane from `+ Branch`, then its {x}. */
async function expectNewLane(page: Page, sheet: Locator, toggleX: number): Promise<void> {
  await sheet.getByTestId('add-branch-button').click()
  const input = cellInput(sheet, limitStem(NEW_LANE))
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('')
  expect.soft(await input.getAttribute('placeholder'), 'the new lane box has no hint').toBeFalsy()
  await expect.soft(sheet.getByText('No limit'), 'no No limit hint').toHaveCount(0)

  const toggle = limitToggle(sheet, NEW_LANE)
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect.soft(switchWarning(page), 'an empty limit switches with no question').toHaveCount(0)
  const box = await rectOf(limitBox(sheet, NEW_LANE), 'new lane {x} box')
  near(box.width, BOX_WIDTH, 'new lane {x} box width')
  near((await rectOf(toggle, 'new lane {x}')).x, toggleX, 'new lane {x} stays in the column')
}

test.describe('V-CTRL-PARALLEL-03: Parallel lane rows', () => {
  let testId = ''

  test.afterEach(async ({ request }) => {
    await deleteControlTest(request, testId)
    testId = ''
  })

  for (const theme of THEMES) {
    test(`lane rows line up with the If/Else name and the Setter value field in the ${theme} theme`, async ({
      page,
      request,
    }, testInfo) => {
      testId = await seedControlTest(request, 'lane-rows', theme)
      const sheet = await openWindow(page, testId, theme, LANE_ROWS_ID, LANE_ROWS_LABEL)
      await attachWindow(testInfo, `parallel-lane-rows-${theme}.png`, sheet)
      const lanes = LANE_ROWS.map(({ id }) => id)

      await test.step('2. each lane name fills the row up to the If/Else name width', async () => {
        for (const lane of lanes) await expectNameBox(sheet, lane)
      })
      let toggleXs: number[] = []
      await test.step('3-5. every time limit box is 357 px, then the expand column, then {x} at one x', async () => {
        toggleXs = await expectLimitColumns(sheet, lanes, [EXPRESSION_LANE])
      })
      await test.step('6. the {x} lane shows its expression whole', () => expectWholeExpression(sheet, EXPRESSION_LANE))
      await test.step('7. the column headers sit over their boxes', () => expectColumnHeaders(sheet, lanes[0]))
      await test.step('3, 5. switching a lane to {x} keeps its box at 357 px and its {x} in place', async () => {
        const cache = lanes[2]
        await limitToggle(sheet, cache).click()
        await expect(limitToggle(sheet, cache)).toHaveAttribute('aria-pressed', 'true')
        await expect.soft(switchWarning(page), 'a lane with no limit switches with no question').toHaveCount(0)
        const box = await rectOf(limitBox(sheet, cache), 'cache {x} box')
        const expand = await rectOf(expandButton(sheet, limitStem(cache)), 'cache expand')
        near(box.width, BOX_WIDTH, 'cache {x} box width')
        near(expand.x - right(box), GAP, 'cache box to expand')
        near((await rectOf(limitToggle(sheet, cache), 'cache {x}')).x, toggleXs[0], 'cache {x} x after the switch')
      })

      await discardBlockSheet(page, sheet)
    })

    test(`Run checks: section limit, lanes, a zero limit and a new lane in the ${theme} theme`, async ({
      page,
      request,
    }, testInfo) => {
      testId = await seedControlTest(request, 'lanes', theme)
      const sheet = await openWindow(page, testId, theme, RUN_CHECKS_ID, RUN_CHECKS_LABEL)
      await attachWindow(testInfo, `parallel-lanes-${theme}.png`, sheet)
      const lanes = RUN_CHECKS_LANES.map(({ id }) => id)
      const integerColor = await resolvedColor(page, 'var(--color-violet-400)')

      await test.step('8. the Section Time Limit row', () => expectSectionLimit(page, sheet))
      await test.step('2. lane names', async () => {
        for (const lane of lanes) await expectNameBox(sheet, lane)
      })
      let toggleXs: number[] = []
      await test.step('3-5. limits in the integer color, the expand and {x} columns', async () => {
        for (const { id, name, limit } of RUN_CHECKS_LANES) {
          await expect(nameBox(sheet, id)).toHaveValue(name)
          const input = cellInput(sheet, limitStem(id))
          await expect(input).toHaveValue(String(limit))
          expect.soft(await elementColor(input, 'color'), `${name} limit color`).toBe(integerColor)
        }
        toggleXs = await expectLimitColumns(sheet, lanes, [])
      })
      await test.step('7. the column headers and spacers', () => expectColumnHeaders(sheet, lanes[0]))
      await test.step('9. JOIN MODE', () => expectJoinMode(sheet))
      await test.step('10. probe set to 0', () => expectZeroLimit(page, sheet))
      await test.step('11. a new lane and its {x}', () => expectNewLane(page, sheet, toggleXs[0]))
      await attachWindow(testInfo, `parallel-lanes-error-${theme}.png`, sheet)

      await discardBlockSheet(page, sheet)
    })
  }
})
