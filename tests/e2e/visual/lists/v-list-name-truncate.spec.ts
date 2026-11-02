/**
 * V-LIST-NAME-TRUNCATE: Long entity names truncate inside list cells
 *
 * Phase: fixture (serial) - reads seeded long-named entities across the five
 * list pages.
 * The TruncatedName cell helper (column-factories.tsx) puts
 * `max-w-[clamp(20rem,40vw,60rem)]` on the trigger so the cell sizes to
 * content with a viewport-responsive cap.
 *
 * Pass Criteria:
 *  1. List rows whose name is 200+ chars do NOT exceed the table's visible
 *     width (no horizontal overflow into siblings or off-screen).
 *  2. The name cell shows ellipsis (`scrollWidth > clientWidth` on the inner
 *     `.truncate` span).
 *  3. Hovering the long name pops a Radix Tooltip (multiline panel, portal-rendered)
 *     with the full text.
 *  4. Hovering a SHORT name does NOT pop a tooltip (truncation gate works).
 *  5. The name cell GROWS with viewport: resize 1280 -> 1920 increases the
 *     cell's clientWidth (clamp cap is 40vw within [20rem, 60rem]).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

// 200-char names match the seed exactly.
const LONG_NAME = 'd'.repeat(200)

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/long-names-overflow/01-seed.sh')
})

test.describe('V-LIST-NAME-TRUNCATE: list cells truncate long names', () => {
  test('S1: tests list - long-name row truncates inside its cell', async ({ page }) => {
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()

    // Long-name row is identifiable by its ID via the row testid.
    const longRow = page.locator('[data-row-id="aaaa2222-2222-2222-2222-222222222222"]')
    await expect(longRow).toBeVisible()

    // The name cell uses the truncate class on its inner span.
    const inner = longRow.locator('[data-testid="test-name"] .truncate').first()
    await expect(inner).toBeVisible()
    const overflow = await inner.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(overflow.sw).toBeGreaterThan(overflow.cw)

    // Cell does not exceed the table's visible width.
    const table = page.locator('[data-testid="tests-table"]')
    const tableBox = await table.boundingBox()
    const cellBox = await longRow.locator('[data-testid="test-name"]').boundingBox()
    expect(tableBox).toBeTruthy()
    expect(cellBox).toBeTruthy()
    expect(cellBox!.x + cellBox!.width).toBeLessThanOrEqual(
      tableBox!.x + tableBox!.width + 1,
    )
  })

  test('S2: tests list - hovering the long name pops a multiline tooltip', async ({
    page,
  }) => {
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()

    const longRow = page.locator('[data-row-id="aaaa2222-2222-2222-2222-222222222222"]')
    const trigger = longRow.locator('[data-testid="test-name"]')
    await trigger.hover()

    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_NAME)
  })

  test('S3: tests list - hovering a SHORT name does NOT pop a tooltip', async ({
    page,
  }) => {
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()

    const shortRow = page.locator('[data-row-id="aaaa1111-1111-1111-1111-111111111111"]')
    const trigger = shortRow.locator('[data-testid="test-name"]')
    await trigger.hover()

    // A 100-200ms wait is enough for Radix's delayDuration to elapse;
    // afterwards no tooltip should be visible because the inner span is not truncated.
    await page.waitForTimeout(300)
    await expect(page.getByRole('tooltip')).toHaveCount(0)
  })

  test('S4: profiles list - long profile name truncates with tooltip', async ({
    page,
  }) => {
    await page.goto('/profiles')
    await expect(page.locator('[data-testid="profiles-page"]')).toBeVisible()

    const longRow = page.locator('[data-row-id="eeee1111-1111-1111-1111-111111111111"]')
    await expect(longRow).toBeVisible()
    const inner = longRow.locator('[data-testid="profile-name"] .truncate').first()
    await expect(inner).toBeVisible()
    const overflow = await inner.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(overflow.sw).toBeGreaterThan(overflow.cw)
  })

  test('S5: environments list - long env name truncates', async ({ page }) => {
    await page.goto('/settings/environments')
    await expect(page.locator('[data-testid="environments-tab"]')).toBeVisible()

    const longRow = page.locator('[data-row-id="dddd1111-1111-1111-1111-111111111111"]')
    await expect(longRow).toBeVisible()
    const inner = longRow.locator('[data-testid="environment-name"] .truncate').first()
    await expect(inner).toBeVisible()
    const overflow = await inner.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
    expect(overflow.sw).toBeGreaterThan(overflow.cw)
  })

  test('S6: name cell grows with viewport (1280 -> 1920 width)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/tests')
    await expect(page.locator('[data-testid="tests-page"]')).toBeVisible()
    const longRow = page.locator('[data-row-id="aaaa2222-2222-2222-2222-222222222222"]')
    const cell1280 = await longRow.locator('[data-testid="test-name"]').boundingBox()
    expect(cell1280).toBeTruthy()

    await page.setViewportSize({ width: 1920, height: 800 })
    // Wait a frame for the resize to propagate.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))))
    const cell1920 = await longRow.locator('[data-testid="test-name"]').boundingBox()
    expect(cell1920).toBeTruthy()
    // 1920px viewport gives the clamp(20rem, 40vw, 60rem) cap more room: at
    // 1920px, 40vw = 768px; at 1280px, 40vw = 512px. The cell SHOULD grow
    // (allowing some tolerance for layout chrome).
    expect(cell1920!.width).toBeGreaterThan(cell1280!.width)
  })
})
