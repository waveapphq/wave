/**
 * V-TESTS-LIST-SUITE-CELL: Tests-list Suite column - single-suite TruncatedName
 * and multi-suite EntityListPopover.
 *
 * REQ: REQ-5.2.1.25 (shared EntityListPopover parity)
 *
 * Pass Criteria:
 *  S1 Single-suite row: cell renders `test-suite` (TruncatedName trigger);
 *     long names truncate within `max-w-[clamp(8rem,18vw,22rem)]` (tighter
 *     than the default 40vw clamp); click navigates to /suites/<id>.
 *  S2 Multi-suite row: cell renders the `test-suite` button labeled
 *     "<N> suites"; click opens `test-suite-list` popover with label
 *     "Suites" and one row per suite (each with the FolderKanban icon).
 *     Clicking a suite row navigates to /suites/<id>.
 *  S3 Popover sizing: popover has min-w-[14rem] max-w-[28rem],
 *     max-h-56, label "Suites" is sticky-left.
 *  S4 Ellipsis visible at narrow viewport: at 700px the long-suite
 *     row's truncate span clips and the cell doesn't bleed past the sticky
 *     Actions column on the right.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const T_SHORT = 'b1100001-0001-0001-0001-000000000001'
const T_LONG = 'b1100002-0002-0002-0002-000000000002'
const T_MULTI = 'b1100003-0003-0003-0003-000000000003'
const S_SHORT = 'c1100001-0001-0001-0001-000000000001'

const LONG_NAME = 'q'.repeat(200)

test.describe('V-TESTS-LIST-SUITE-CELL: Suite cell single-vs-multi rendering', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh')
  })

  test('V-TESTS-LIST-SUITE-CELL-S1: single-suite cell uses TruncatedName, click navigates', async ({
    page,
  }) => {
    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    const shortTestRow = page.locator(`[data-row-id="${T_SHORT}"]`)
    await expect(shortTestRow).toBeVisible()

    const suiteCell = shortTestRow.locator('[data-testid="test-suite"]')
    await expect(suiteCell).toBeVisible()
    await expect(suiteCell).toContainText('Smoke Suite')

    // The TruncatedName trigger is capped at max-w-[clamp(8rem,18vw,22rem)].
    const className = (await suiteCell.getAttribute('class')) ?? ''
    expect(className).toContain('max-w-[clamp(8rem,18vw,22rem)]')

    // Click navigates to /suites/<id>.
    await suiteCell.click()
    await expect(page).toHaveURL(new RegExp(`/suites/${S_SHORT}$`))
  })

  test('V-TESTS-LIST-SUITE-CELL-S2: multi-suite cell uses EntityListPopover with "Suites" label', async ({
    page,
  }) => {
    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    const multiRow = page.locator(`[data-row-id="${T_MULTI}"]`)
    await expect(multiRow).toBeVisible()

    const suiteTrigger = multiRow.locator('[data-testid="test-suite"]')
    await expect(suiteTrigger, 'Multi-suite cell renders the popover trigger').toBeVisible()
    await expect(suiteTrigger).toContainText(/^3 suites$/)

    await suiteTrigger.click()
    const popover = page.locator('[data-testid="test-suite-list"]')
    await expect(popover, 'Suite list popover opens').toBeVisible()
    await expect(popover, 'Popover header reads "Suites"').toContainText('Suites')

    // One row per suite (Alpha, Beta, Gamma). All show the orange FolderKanban
    // icon (suite color #F59E0B).
    await expect(popover).toContainText('Alpha Suite')
    await expect(popover).toContainText('Beta Suite')
    await expect(popover).toContainText('Gamma Suite')
    await expect(
      popover.locator('span[style*="color: rgb(245, 158, 11)"]'),
    ).toHaveCount(3)

    // Clicking a suite navigates.
    await popover.getByRole('button', { name: /Alpha Suite/ }).click()
    await expect(page).toHaveURL(/\/suites\/c1100003-0003-0003-0003-000000000003$/)
  })

  test('V-TESTS-LIST-SUITE-CELL-S3: popover sizing (min/max width, sticky header)', async ({
    page,
  }) => {
    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    const multiRow = page.locator(`[data-row-id="${T_MULTI}"]`)
    await multiRow.locator('[data-testid="test-suite"]').click()

    const popover = page.locator('[data-testid="test-suite-list"]')
    await expect(popover).toBeVisible()

    // The "Suites" header is rendered inside the scroll container and is
    // sticky-left so it stays visible during horizontal scroll. The popover
    // content (Radix-rendered parent) carries the min/max-width classes.
    const popoverContent = popover.locator('xpath=..')
    const contentClass = (await popoverContent.getAttribute('class')) ?? ''
    expect(contentClass).toContain('min-w-[14rem]')
    expect(contentClass).toContain('max-w-[28rem]')
    expect(contentClass).toContain('w-max')

    // The inner scroll container has max-h-56 + overflow-auto.
    const innerClass = (await popover.getAttribute('class')) ?? ''
    expect(innerClass).toContain('max-h-56')
    expect(innerClass).toContain('overflow-auto')

    // Header has sticky-left class.
    const header = popover.locator('p').filter({ hasText: 'Suites' })
    const headerClass = (await header.getAttribute('class')) ?? ''
    expect(headerClass).toContain('sticky')
  })

  test('V-TESTS-LIST-SUITE-CELL-S4: long suite name truncates with ellipsis visible at narrow viewport', async ({
    page,
  }) => {
    // Tighter clamp keeps the ellipsis visible even at narrow viewports
    // between the sticky-left Name column and sticky-right Actions column.
    await page.setViewportSize({ width: 1024, height: 800 })
    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })

    const longTestRow = page.locator(`[data-row-id="${T_LONG}"]`)
    await expect(longTestRow).toBeVisible()

    const suiteCell = longTestRow.locator('[data-testid="test-suite"]')
    await expect(suiteCell).toBeVisible()
    // The 200-char suite name is the source - the cell shows the long name.
    await expect(suiteCell).toContainText(LONG_NAME.slice(0, 30))

    // Inner .truncate span clips (scrollWidth > clientWidth).
    const inner = suiteCell.locator('.truncate').first()
    const measured = await inner.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }))
    expect(measured.sw).toBeGreaterThan(measured.cw + 1)

    // Cell doesn't bleed past the table's visible bounds.
    const table = page.locator('[data-testid="tests-table"]')
    const tableBox = await table.boundingBox()
    const cellBox = await suiteCell.boundingBox()
    expect(tableBox).toBeTruthy()
    expect(cellBox).toBeTruthy()
    expect(cellBox!.x + cellBox!.width).toBeLessThanOrEqual(
      tableBox!.x + tableBox!.width + 1,
    )

    // Hover surfaces the multiline tooltip.
    await suiteCell.hover()
    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_NAME)
  })
})
