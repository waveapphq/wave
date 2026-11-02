/**
 * V-ENTITY-LIST-POPOVER-PARITY: Cross-surface chrome parity for EntityListPopover
 *
 * REQ: REQ-5.2.1.25 (single shared popover component across all surfaces)
 *
 * Pass Criteria:
 *  S1 Canvas breadcrumb collapse popover, the detail-header prefix collapse
 *     popover, and the tests-list multi-suite popover ALL use the same
 *     chrome (Radix Popover content with `min-w-[14rem]`, `max-w-[28rem]`,
 *     `w-max`, `p-0`; inner list with `max-h-56 overflow-auto p-2`; sticky
 *     header `p` element with the section label).
 *
 *  S2 Row layout parity: each list row uses
 *     `flex items-center gap-2 px-2 py-1 text-sm rounded whitespace-nowrap min-w-full`.
 *
 * Note: The collision-resolution modal also consumes `EntityListPopover`
 * (see frontend/src/components/shared/dialogs/collision-resolution-modal.tsx).
 * That surface is covered by the unit test
 * `frontend/tests/components/shared/dialogs/collision-resolution-modal.test.tsx`
 * which asserts the shared component is imported and rendered.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { waitForCanvasLoad } from '../../helpers/canvas'
import { BACKEND_PORT } from '../../helpers/config'

const T_LONG = 'b1100002-0002-0002-0002-000000000002'
const T_MULTI = 'b1100003-0003-0003-0003-000000000003'
const S_LONG = 'c1100002-0002-0002-0002-000000000002'
const R_LONG = 'd1100002-0002-0002-0002-000000000002'

interface SurfaceShape {
  contentClass: string
  innerClass: string
  rowClass: string
  headerText: string
}

async function captureSurface(popoverContent: Locator): Promise<SurfaceShape> {
  // The Radix popover content (parent of the listTestId-tagged div) carries
  // sizing classes; the inner div carries max-h + overflow; the first <p>
  // inside is the sticky label; the first row button/div carries the row
  // layout.
  const parent = popoverContent.locator('xpath=..')
  const contentClass = (await parent.getAttribute('class')) ?? ''
  const innerClass = (await popoverContent.getAttribute('class')) ?? ''
  const headerEl = popoverContent.locator('p').first()
  const headerText = (await headerEl.textContent())?.trim() ?? ''
  const headerClass = (await headerEl.getAttribute('class')) ?? ''
  // First row is either a button (href set) or a div (no href).
  const rowEl = popoverContent.locator('button, div[data-testid]:not([data-testid$="-list"])').first()
  const rowClass = (await rowEl.getAttribute('class')) ?? ''

  // Embed the header sticky check into the returned headerText assertions.
  expect(headerClass).toContain('sticky')
  return { contentClass, innerClass, rowClass, headerText }
}

function assertSharedChrome(shape: SurfaceShape): void {
  // Sizing rules
  expect(shape.contentClass).toContain('min-w-[14rem]')
  expect(shape.contentClass).toContain('max-w-[28rem]')
  expect(shape.contentClass).toContain('w-max')
  expect(shape.contentClass).toContain('p-0')
  // Inner scroll container
  expect(shape.innerClass).toContain('max-h-56')
  expect(shape.innerClass).toContain('overflow-auto')
  expect(shape.innerClass).toContain('p-2')
  // Row layout
  expect(shape.rowClass).toContain('flex')
  expect(shape.rowClass).toContain('items-center')
  expect(shape.rowClass).toContain('gap-2')
  expect(shape.rowClass).toContain('px-2')
  expect(shape.rowClass).toContain('py-1')
  expect(shape.rowClass).toContain('text-sm')
  expect(shape.rowClass).toContain('whitespace-nowrap')
  expect(shape.rowClass).toContain('min-w-full')
}

async function ensureCleanWorkbench(page: Page): Promise<void> {
  await page.request.delete(`http://localhost:${BACKEND_PORT}/workbench/session`).catch(() => {})
  await page.goto('/tests')
  await page.evaluate(() => localStorage.clear())
  // GET only - POST must reach the BE so the editTest navigation creates a
  // real session.
  await page.route('**/workbench/session', (route) => {
    if (route.request().method() === 'GET') {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: null }),
      })
    } else {
      route.continue()
    }
  })
}

test.describe('V-ENTITY-LIST-POPOVER-PARITY: shared chrome across surfaces', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/breadcrumb/v-breadcrumb-01/01-seed.sh')
  })

  test('V-ENTITY-LIST-POPOVER-PARITY-S1: chrome + row layout identical on all three surfaces', async ({
    page,
  }) => {
    // --- Surface 1: canvas breadcrumb collapse popover ---
    await ensureCleanWorkbench(page)
    await page.goto(`/workbench?editTest=${T_LONG}&suiteId=${S_LONG}&regressionId=${R_LONG}`)
    await waitForCanvasLoad(page)
    await page.locator('[data-testid="breadcrumb-collapse-button"]').click()
    const breadcrumbPopover = page.locator('[data-testid="breadcrumb-parents-list"]')
    await expect(breadcrumbPopover).toBeVisible()
    expect((await breadcrumbPopover.locator('p').first().textContent())?.trim()).toBe('Parent path')
    const breadcrumbShape = await captureSurface(breadcrumbPopover)
    assertSharedChrome(breadcrumbShape)

    // --- Surface 2: detail-header prefix collapse popover ---
    await page.goto(`/suites/${S_LONG}?regressionId=${R_LONG}`)
    await page.waitForSelector('[data-testid="suite-detail-page"]', { state: 'visible' })
    await page.locator('[data-testid="detail-breadcrumb-collapse-button"]').click()
    const detailPopover = page.locator('[data-testid="detail-breadcrumb-parents-list"]')
    await expect(detailPopover).toBeVisible()
    expect((await detailPopover.locator('p').first().textContent())?.trim()).toBe('Parent path')
    const detailShape = await captureSurface(detailPopover)
    assertSharedChrome(detailShape)

    // --- Surface 3: tests-list multi-suite popover ---
    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
    const multiRow = page.locator(`[data-row-id="${T_MULTI}"]`)
    await multiRow.locator('[data-testid="test-suite"]').click()
    const multiSuitePopover = page.locator('[data-testid="test-suite-list"]')
    await expect(multiSuitePopover).toBeVisible()
    expect((await multiSuitePopover.locator('p').first().textContent())?.trim()).toBe('Suites')
    const multiSuiteShape = await captureSurface(multiSuitePopover)
    assertSharedChrome(multiSuiteShape)

    // Sanity: each surface produced the same chrome classes (the assertions
    // above prove it via the shared assertion helper, but call out the
    // intent of the parity test here as well).
    expect(breadcrumbShape.contentClass).toBe(detailShape.contentClass)
    expect(detailShape.contentClass).toBe(multiSuiteShape.contentClass)
  })

  test('V-ENTITY-LIST-POPOVER-PARITY-S2: row entries with href render as buttons (clickable)', async ({
    page,
  }) => {
    // All three surfaces use href on every row -> rows render as <button>
    // elements (entity-list-popover.tsx line 115). Static <div> rows (no href)
    // are only used by the collision-resolution modal which is covered by
    // its unit test.
    await page.goto('/tests')
    await page.waitForSelector('[data-testid="tests-page"]', { state: 'visible' })
    await page.locator(`[data-row-id="${T_MULTI}"] [data-testid="test-suite"]`).click()

    const popover = page.locator('[data-testid="test-suite-list"]')
    await expect(popover).toBeVisible()

    // Three suite rows, each rendered as a clickable button.
    const buttons = popover.locator('button')
    await expect(buttons).toHaveCount(3)
  })
})
