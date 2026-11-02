/**
 * V-DETAIL-HEADER-CASCADE: Suite-from-regression detail-header cascade A -> B -> C
 *
 * REQ: REQ-5.2.1.25 (detail-header breadcrumb prefix)
 *
 * Pass Criteria:
 *  S1 State A (full): short regression + short suite names; prefix link
 *     `detail-breadcrumb-regression` is visible with the regression name.
 *  S2 State B (collapsed): long regression name (or long suite title) trips
 *     collapse. The prefix collapses to a single `detail-breadcrumb-collapsed`
 *     wrapper exposing a `detail-breadcrumb-collapse-button`.
 *  S3 Popover navigation: clicking the `...` opens
 *     `detail-breadcrumb-parents-list` with a "Parent path" header.
 *     Clicking the regression entry navigates to `/regressions/<id>` (the
 *     `...` itself must NOT navigate; only the popover row does).
 *  S4 State C: leaf title (suite name) still doesn't fit after collapse;
 *     the title's TruncatedName inner span overflows and hover surfaces
 *     the multiline Radix tooltip.
 *  S5 Back arrow target: when arriving suite-from-regression, the page
 *     back-arrow goes to `/regressions/<id>` (NOT `/suites`).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const S_SHORT = 'c1100001-0001-0001-0001-000000000001'
const S_LONG = 'c1100002-0002-0002-0002-000000000002'
const R_SHORT = 'd1100001-0001-0001-0001-000000000001'
const R_LONG = 'd1100002-0002-0002-0002-000000000002'

const LONG_NAME = 'q'.repeat(200)

test.describe('V-DETAIL-HEADER-CASCADE: suite-from-regression cascade', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh')
  })

  test('V-DETAIL-HEADER-CASCADE-S1: State A - short names render the regression prefix link in full', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_SHORT}?regressionId=${R_SHORT}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    // Regression prefix link visible with the regression name.
    const prefix = page.locator('[data-testid="detail-breadcrumb-regression"]')
    await expect(prefix, 'Regression prefix is rendered (not collapsed)').toBeVisible()
    await expect(prefix).toContainText('Nightly Smoke')

    // No collapse trigger present.
    await expect(page.locator('[data-testid="detail-breadcrumb-collapsed"]')).toHaveCount(0)
  })

  test('V-DETAIL-HEADER-CASCADE-S2: State B - long regression name collapses prefix to "..."', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_LONG}?regressionId=${R_LONG}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    // 200-char regression name forces the prefix into the collapsed state.
    const collapsed = page.locator('[data-testid="detail-breadcrumb-collapsed"]')
    await expect(collapsed, 'Long regression name trips the prefix collapse').toBeVisible()
    await expect(
      page.locator('[data-testid="detail-breadcrumb-collapse-button"]'),
    ).toBeVisible()
    // When collapsed, the inline prefix link should be GONE.
    await expect(page.locator('[data-testid="detail-breadcrumb-regression"]')).toHaveCount(0)
  })

  test('V-DETAIL-HEADER-CASCADE-S3: collapsed popover opens, navigates on row click', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_LONG}?regressionId=${R_LONG}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    const collapseBtn = page.locator('[data-testid="detail-breadcrumb-collapse-button"]')
    await expect(collapseBtn).toBeVisible()
    await collapseBtn.click()

    const popover = page.locator('[data-testid="detail-breadcrumb-parents-list"]')
    await expect(popover, 'Parents list popover opens on click').toBeVisible()
    await expect(popover, 'Header reads "Parent path"').toContainText('Parent path')

    // One row for the regression parent; clicking it navigates to /regressions/<id>.
    const regressionRow = popover.locator('button').filter({ hasText: LONG_NAME.slice(0, 30) }).first()
    await expect(regressionRow).toBeVisible()
    await regressionRow.click()
    await expect(page).toHaveURL(new RegExp(`/regressions/${R_LONG}$`))
  })

  test('V-DETAIL-HEADER-CASCADE-S4: State C - long suite title overflows and hover surfaces multiline tooltip', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_LONG}?regressionId=${R_LONG}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    // Title h1 contains the TruncatedName inner .truncate span; with a
    // 200-char suite name it clips against its parent.
    const titleSpan = page.locator('h1 .truncate').first()
    await expect(titleSpan).toBeVisible()
    const measured = await titleSpan.evaluate((el) => ({
      sw: el.scrollWidth,
      cw: el.clientWidth,
    }))
    expect(measured.sw).toBeGreaterThan(measured.cw + 1)

    await titleSpan.hover()
    const tooltip = page.getByRole('tooltip').first()
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toHaveText(LONG_NAME)
  })

  test('V-DETAIL-HEADER-CASCADE-S5: back arrow goes to /regressions/<id> when arriving suite-from-regression', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_SHORT}?regressionId=${R_SHORT}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    const backBtn = page.locator('[data-testid="detail-back-btn"]')
    await expect(backBtn).toBeVisible()
    await backBtn.click()
    await expect(page).toHaveURL(new RegExp(`/regressions/${R_SHORT}$`))
  })
})
