/**
 * V-CANVAS-BREADCRUMB-TRUNCATION: Workbench canvas breadcrumb cascade A -> B -> C.
 *
 * REQ: REQ-5.2.1.25 (workbench breadcrumb)
 *
 * Pass Criteria:
 *  S1 State A (full): regression-origin edit-mode with short names fits in the
 *     bar; all 3 segments render with no `...` collapse trigger.
 *  S2 State B (collapsed via long parent): regression-origin edit-mode where
 *     the regression name is 200 chars; ALL parents collapse to a single
 *     `breadcrumb-collapse-button`. The leaf renders in full.
 *  S3 Parent popover: clicking the `...` opens `breadcrumb-parents-list` with
 *     a "Parent path" header and one row per parent.
 *  S4 State C (truncated leaf): the leaf alone is wider than the available
 *     space after collapse. The inner span has `scrollWidth > clientWidth + 1`
 *     AND hovering it surfaces the multiline tooltip with the full name.
 *  S5 onTruncatedChange trigger: a long-LEAF-only path (short parents) also
 *     trips the collapse via the leaf truncation signal, proving both the
 *     container-overflow path (A) AND the leaf truncation path (B) drive
 *     `shouldCollapse=true`.
 */

import { test, expect, type Page } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const T_SHORT = 'b1100001-0001-0001-0001-000000000001'
const T_LONG = 'b1100002-0002-0002-0002-000000000002'
const S_SHORT = 'c1100001-0001-0001-0001-000000000001'
const S_LONG = 'c1100002-0002-0002-0002-000000000002'
const R_SHORT = 'd1100001-0001-0001-0001-000000000001'
const R_LONG = 'd1100002-0002-0002-0002-000000000002'

const LONG_NAME = 'q'.repeat(200)

async function ensureCleanWorkbench(page: Page): Promise<void> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/tests')
  await page.evaluate(() => localStorage.clear())
}

async function gotoWorkbench(page: Page, query: string): Promise<void> {
  await page.goto(`/workbench${query}`)
  await waitForCanvasLoad(page)
  await expect(page.locator('[data-testid="canvas-breadcrumb"]')).toBeVisible()
}

test.describe('V-CANVAS-BREADCRUMB-TRUNCATION: cascade A -> B -> C', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh')
  })

  test.beforeEach(async ({ page }) => {
    await ensureCleanWorkbench(page)
  })

  test('V-CANVAS-BREADCRUMB-TRUNCATION-S1: State A - everything fits, all 3 segments render with no collapse', async ({
    page,
  }) => {
    await gotoWorkbench(page, `?editTest=${T_SHORT}&suiteId=${S_SHORT}&regressionId=${R_SHORT}`)
    // Wait for parent names to land.
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Nightly Smoke')
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Smoke Suite')
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText('Login Check')

    // No collapse trigger present.
    await expect(page.locator('[data-testid="breadcrumb-collapse-button"]')).toHaveCount(0)
  })

  test('V-CANVAS-BREADCRUMB-TRUNCATION-S2: State B - long regression name collapses parents to "..."', async ({
    page,
  }) => {
    // Regression has the 200-char name; the suite/test underneath are short.
    // The container overflow trigger (path A) fires and collapses parents.
    await gotoWorkbench(page, `?editTest=${T_LONG}&suiteId=${S_LONG}&regressionId=${R_LONG}`)
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText(LONG_NAME.slice(0, 30))

    const collapseBtn = page.locator('[data-testid="breadcrumb-collapse-button"]')
    await expect(collapseBtn, 'Parents collapse to a single ... button').toBeVisible()
  })

  test('V-CANVAS-BREADCRUMB-TRUNCATION-S3: Parent popover opens with "Parent path" header and one row per parent', async ({
    page,
  }) => {
    await gotoWorkbench(page, `?editTest=${T_LONG}&suiteId=${S_LONG}&regressionId=${R_LONG}`)

    const collapseBtn = page.locator('[data-testid="breadcrumb-collapse-button"]')
    await expect(collapseBtn).toBeVisible()
    await collapseBtn.click()

    const popover = page.locator('[data-testid="breadcrumb-parents-list"]')
    await expect(popover, 'Parent list popover opens on click').toBeVisible()
    await expect(popover, 'Header reads "Parent path"').toContainText('Parent path')

    // One row per parent (regression + suite).
    // Names are 200-char tokens so just verify the leading characters and
    // that the segment icon (purple + orange) lands inside the popover.
    await expect(popover).toContainText(LONG_NAME.slice(0, 30))

    // Both segment icons rendered (regression purple #A78BFA + suite orange #F59E0B).
    await expect(
      popover.locator('span[style*="color: rgb(167, 139, 250)"]'),
    ).toHaveCount(1)
    await expect(
      popover.locator('span[style*="color: rgb(245, 158, 11)"]'),
    ).toHaveCount(1)
  })

  test('V-CANVAS-BREADCRUMB-TRUNCATION-S4: State C - long leaf overflows after collapse; hover surfaces multiline tooltip', async ({
    page,
  }) => {
    await gotoWorkbench(page, `?editTest=${T_LONG}&suiteId=${S_LONG}&regressionId=${R_LONG}`)

    // After collapse the leaf (200-char test name) is the only path content
    // besides the `...`. Its inner span clips with text-overflow:ellipsis
    // and its scrollWidth exceeds clientWidth.
    const leafSpan = page
      .locator('[data-testid="breadcrumb-path"] .truncate')
      .last()
    await expect(leafSpan).toBeVisible()
    const measured = await leafSpan.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }))
    expect(measured.sw).toBeGreaterThan(measured.cw + 1)

    // Hover the leaf trigger - the TruncatedName tooltip surfaces in a portal
    // with role="tooltip" and the full long name as its content.
    await leafSpan.hover()
    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_NAME)
  })

  test('V-CANVAS-BREADCRUMB-TRUNCATION-S5: long-LEAF-only path collapses via onTruncatedChange (path B)', async ({
    page,
  }) => {
    // Short parents + long leaf. The container alone could fit the leaf
    // unclipped only because the parents are tiny - but the leaf's
    // TruncatedName.onTruncatedChange detects the clip and triggers collapse
    // anyway. Proves path B (leaf signal drives collapse).
    await gotoWorkbench(page, `?editTest=${T_LONG}&suiteId=${S_SHORT}&regressionId=${R_SHORT}`)
    await expect(page.locator('[data-testid="breadcrumb-path"]')).toContainText(LONG_NAME.slice(0, 30))

    // Collapse trigger appears even though parents are short, because the
    // leaf alone exceeds the available width.
    await expect(page.locator('[data-testid="breadcrumb-collapse-button"]')).toBeVisible()
  })
})
