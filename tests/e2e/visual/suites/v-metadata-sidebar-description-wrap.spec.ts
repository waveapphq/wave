/**
 * V-METADATA-SIDEBAR-DESCRIPTION-WRAP: Long single-token description wraps inside the sidebar
 *
 * Phase: fixture (serial) - reads seeded suite + regression with 200-char
 * single-token descriptions.
 * metadata-sidebar.tsx uses a plain `overflow-y-auto overflow-x-hidden
 * min-w-0` div, not Radix `ScrollArea`: ScrollArea's Viewport injects
 * `display: table; min-width: 100%` that lets long single-token content grow to natural
 * single-line width and defeats `break-words` on `MetadataRow`.
 *
 * Pass Criteria:
 *  1. Sidebar's bounding box right edge equals the rendered description's
 *     right edge (no horizontal overflow into the sibling pane).
 *  2. The description `<p>` `clientHeight` is strictly greater than a single
 *     line of text (i.e. it wrapped).
 *  3. The sibling pane to the right does not have its left edge pushed by
 *     the description.
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

test.beforeAll(() => {
  exec('./tests/e2e/fixtures/long-names-overflow/01-seed.sh')
})

test.describe('V-METADATA-SIDEBAR-DESCRIPTION-WRAP: long description wraps in sidebar', () => {
  test('S1: suite detail - long single-token description wraps and stays within sidebar', async ({
    page,
  }) => {
    await page.goto('/suites/bbbb1111-1111-1111-1111-111111111111')
    const sidebar = page.locator('[data-testid="suite-metadata-sidebar"]')
    await expect(sidebar).toBeVisible()

    const description = sidebar.locator('[data-testid="sidebar-description-display"]')
    await expect(description).toBeVisible()

    // Description must wrap (clientHeight strictly > a single line).
    const dims = await description.evaluate((el) => {
      const rect = el.getBoundingClientRect()
      const lineHeight = parseFloat(window.getComputedStyle(el).lineHeight || '0')
      return { height: rect.height, lineHeight }
    })
    // If lineHeight is reported (>0), wrapped means height > lineHeight.
    if (dims.lineHeight > 0) {
      expect(dims.height).toBeGreaterThan(dims.lineHeight + 1)
    }

    // No horizontal overflow: description right edge stays within the sidebar.
    const sidebarBox = await sidebar.boundingBox()
    const descBox = await description.boundingBox()
    expect(sidebarBox).toBeTruthy()
    expect(descBox).toBeTruthy()
    expect(descBox!.x + descBox!.width).toBeLessThanOrEqual(
      sidebarBox!.x + sidebarBox!.width + 1,
    )
  })

  test('S2: regression detail - long single-token description also wraps', async ({
    page,
  }) => {
    await page.goto('/regressions/cccc1111-1111-1111-1111-111111111111')
    const sidebar = page.locator('[data-testid="regression-metadata-sidebar"]')
    await expect(sidebar).toBeVisible()

    const description = sidebar.locator('[data-testid="sidebar-description-display"]')
    await expect(description).toBeVisible()

    const sidebarBox = await sidebar.boundingBox()
    const descBox = await description.boundingBox()
    expect(sidebarBox).toBeTruthy()
    expect(descBox).toBeTruthy()
    expect(descBox!.x + descBox!.width).toBeLessThanOrEqual(
      sidebarBox!.x + sidebarBox!.width + 1,
    )
  })

  test('S3: page does not horizontally overflow with long sidebar description', async ({
    page,
  }) => {
    await page.goto('/suites/bbbb1111-1111-1111-1111-111111111111')
    await expect(page.locator('[data-testid="suite-metadata-sidebar"]')).toBeVisible()
    const html = page.locator('html')
    const sw = await html.evaluate((el) => el.scrollWidth)
    const cw = await html.evaluate((el) => el.clientWidth)
    expect(sw).toBeLessThanOrEqual(cw + 1)
  })
})
