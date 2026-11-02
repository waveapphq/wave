/**
 * V-DETAIL-HEADER-ICONS: entity-color icons on Regression / Suite / Execution
 * detail headers.
 *
 * REQ: REQ-5.2.1.25 (detail-header entity icon parity with sidebar)
 *
 * Pass Criteria:
 *  S1 Regression detail: `detail-entity-icon-regression` rendered with the
 *     GitBranch lucide path inside a span whose inline color is
 *     `rgb(167, 139, 250)` (#A78BFA).
 *  S2 Suite detail (standalone): `detail-entity-icon-suite` rendered with
 *     FolderKanban + orange `rgb(245, 158, 11)` (#F59E0B). No prefix link
 *     when no `regressionId` query param.
 *  S3 Suite from regression: `detail-entity-icon-suite` still shows orange;
 *     the inline regression prefix link icon uses purple `rgb(167, 139, 250)`.
 *  S4 Execution detail: `detail-entity-icon-execution` rendered with Play +
 *     blue `rgb(96, 165, 250)` (#60A5FA).
 */

import { test, expect } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'

const S_SHORT = 'c1100001-0001-0001-0001-000000000001'
const R_SHORT = 'd1100001-0001-0001-0001-000000000001'
const EXEC_SUITE_RUN = 'e1100002-0002-0002-0002-000000000002'

test.describe('V-DETAIL-HEADER-ICONS: sidebar-color entity icons on detail headers', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh')
  })

  test('V-DETAIL-HEADER-ICONS-S1: Regression detail shows purple GitBranch icon', async ({
    page,
  }) => {
    await page.goto(`/regressions/${R_SHORT}`)
    await page.waitForSelector('[data-testid="regression-detail-page"]', { state: 'visible' })

    const icon = page.locator('[data-testid="detail-entity-icon-regression"]')
    await expect(icon, 'Regression entity icon rendered').toBeVisible()
    // GitBranch in purple #A78BFA (rgb 167, 139, 250).
    const color = await icon.evaluate((el) => (el as HTMLElement).style.color)
    expect(color).toBe('rgb(167, 139, 250)')
  })

  test('V-DETAIL-HEADER-ICONS-S2: Suite detail (standalone) shows orange FolderKanban icon, no prefix link', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_SHORT}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    const icon = page.locator('[data-testid="detail-entity-icon-suite"]')
    await expect(icon, 'Suite entity icon rendered').toBeVisible()
    // FolderKanban in orange #F59E0B (rgb 245, 158, 11).
    const color = await icon.evaluate((el) => (el as HTMLElement).style.color)
    expect(color).toBe('rgb(245, 158, 11)')

    // No regression prefix when arriving standalone.
    await expect(page.locator('[data-testid="detail-breadcrumb-regression"]')).toHaveCount(0)
    await expect(page.locator('[data-testid="detail-breadcrumb-collapsed"]')).toHaveCount(0)
  })

  test('V-DETAIL-HEADER-ICONS-S3: Suite-from-regression shows purple prefix icon + orange suite icon', async ({
    page,
  }) => {
    await page.goto(`/suites/${S_SHORT}?regressionId=${R_SHORT}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })

    // Prefix link rendered (short names, no collapse).
    const prefix = page.locator('[data-testid="detail-breadcrumb-regression"]')
    await expect(prefix).toBeVisible()

    // Prefix icon is purple GitBranch.
    const prefixIcon = prefix.locator('span[style*="color: rgb(167, 139, 250)"]').first()
    await expect(prefixIcon).toBeVisible()

    // Suite entity icon is orange.
    const suiteIcon = page.locator('[data-testid="detail-entity-icon-suite"]')
    await expect(suiteIcon).toBeVisible()
    const suiteColor = await suiteIcon.evaluate((el) => (el as HTMLElement).style.color)
    expect(suiteColor).toBe('rgb(245, 158, 11)')
  })

  test('V-DETAIL-HEADER-ICONS-S4: Execution detail (suite-type) shows blue Play icon', async ({
    page,
  }) => {
    // Use a suite-type execution; test-type executions redirect to the
    // history canvas, which has no DetailHeader. Suite/regression executions
    // stay on /executions/<id> and render DetailHeader with entityType="execution".
    await page.goto(`/executions/${EXEC_SUITE_RUN}`)
    await page.waitForSelector('[data-testid="execution-detail-page"]', { state: 'visible' })

    const icon = page.locator('[data-testid="detail-entity-icon-execution"]')
    await expect(icon, 'Execution entity icon rendered').toBeVisible()
    // Play in blue #60A5FA (rgb 96, 165, 250).
    const color = await icon.evaluate((el) => (el as HTMLElement).style.color)
    expect(color).toBe('rgb(96, 165, 250)')
  })
})
