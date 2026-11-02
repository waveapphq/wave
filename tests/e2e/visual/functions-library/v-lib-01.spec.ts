/**
 * V-LIB-01: Functions library list page.
 * Design Decisions: FNLIST-1..11
 * REQ: REQ-3.1.2.1
 *
 * Pass Criteria:
 * 1. /functions lists published Functions with Name(+desc)/Tags/Version/Updated/Actions.
 * 2. Search narrows the list; row actions (view + overflow export/delete) render.
 * 3. Pagination splits a >1-page library; a non-matching filter shows the empty state.
 * 4. Name sort is GLOBAL across pages and Version sort is semver-ordered.
 * 5. A long unbroken description does not blow out the row width; it
 *    clips with an ellipsis and reveals the full text in a hover popover.
 *
 * Self-seeds via POST /functions under a per-run name prefix, so it runs in the
 * no-data phase without depending on (or disturbing) other seeded Functions.
 */

import { test, expect, type APIRequestContext, type Page } from '../../helpers/playwright-fixtures'
import { publishLibraryFunction } from '../../helpers/fn-seed'
import { randomUUID } from 'node:crypto'

const RUN = randomUUID().slice(0, 8)
// Two disjoint prefixes so the sort set and the long-description fixture never
// match each other's search.
const SORT_PREFIX = `VLIB01S${RUN}`
const LONG_PREFIX = `VLIB01L${RUN}`
// One long unbroken token: no break opportunity, so only a width cap can clip it.
const LONG_DESC = `desc${'x'.repeat(280)}`

const ROW = '[data-testid="function-row"]'
const NAME = '[data-testid="function-name"]'
const VERSION = '[data-testid="function-version"]'

async function seedLibrary(request: APIRequestContext): Promise<void> {
  // 12 functions, names zero-padded so lexical order equals numeric order, and
  // versions 1.0.0..12.0.0 so a semver sort differs from a lexical one
  // (lexical would place 10/11/12 right after 1).
  for (let i = 1; i <= 12; i++) {
    const nn = String(i).padStart(2, '0')
    await publishLibraryFunction(request, {
      name: `${SORT_PREFIX}-${nn}`,
      version: `${i}.0.0`,
      tags: [SORT_PREFIX],
      description: `Function ${nn}`,
    })
  }
  await publishLibraryFunction(request, {
    name: `${LONG_PREFIX}-01`,
    version: '1.0.0',
    tags: [LONG_PREFIX],
    description: LONG_DESC,
  })
}

async function gotoFiltered(page: Page, prefix: string): Promise<void> {
  await page.goto('/functions')
  await expect(page.locator('[data-testid="functions-page"]')).toBeVisible()
  // The search testid is on the SearchInput wrapper; the field is the inner input.
  await page.locator('[data-testid="search-input"] input').fill(prefix)
  // Wait for the debounced search to settle (first row reflects the filter) before
  // a caller changes page size or sort - otherwise that change races the in-flight
  // fetch and is dropped (page size reverts to default, so page 1 shows all matches).
  await expect(page.locator(ROW).first().locator(NAME)).toContainText(prefix, { timeout: 10_000 })
}

async function setPageSize(page: Page, size: string): Promise<void> {
  await page.locator('[data-testid="page-size-selector"]').click()
  await page.getByRole('option', { name: size, exact: true }).click()
}

/** Click a sortable column header. The table is server-side + 3-state with
 *  sortDescFirst:false, so click 1 = ascending, click 2 = descending. Reads
 *  after a click use retrying assertions to wait for the sorted reload. */
async function clickHeader(page: Page, label: string): Promise<void> {
  await page.locator('th').filter({ hasText: new RegExp(`^${label}$`, 'i') }).first().click()
}

test.describe('V-LIB-01: Functions library list', () => {
  test.beforeAll(async ({ request }) => {
    await seedLibrary(request)
  })

  test('V-LIB-01-S1: search, columns, row actions, pagination', async ({ page }) => {
    await gotoFiltered(page, SORT_PREFIX)
    await setPageSize(page, '10')

    // 12 seeded, 10 per page -> page 1 holds 10 rows.
    await expect(page.locator(ROW)).toHaveCount(10)
    await expect(page.locator('[data-testid="pagination-item-count"]')).toContainText('12')

    // Columns + per-row actions (view always visible; export/delete in overflow).
    const firstRow = page.locator(ROW).first()
    await expect(firstRow.locator(NAME)).toBeVisible()
    await expect(firstRow.locator(VERSION)).toBeVisible()
    await expect(firstRow.locator('[data-testid="action-view"]')).toBeVisible()
    await expect(firstRow.locator('[data-testid="action-menu-trigger"]')).toBeVisible()
    await firstRow.locator('[data-testid="action-menu-trigger"]').click()
    await expect(page.locator('[data-testid="action-export"]')).toBeVisible()
    await expect(page.locator('[data-testid="action-delete"]')).toBeVisible()
    await page.keyboard.press('Escape')

    // Page 2 holds the remaining 2 rows.
    await page.locator('[data-testid="pagination"]').getByRole('button', { name: /next page/i }).click()
    await expect(page.locator(ROW)).toHaveCount(2)

    // A non-matching filter shows the filtered-empty state.
    await page.locator('[data-testid="search-input"] input').fill(`nomatch-${RUN}`)
    await expect(page.locator('[data-testid="no-results-state"]')).toBeVisible()
  })

  test('V-LIB-01-S2: Name sort is GLOBAL across pages, not per-page', async ({ page }) => {
    // Sorting runs on the server BEFORE pagination. The list defaults to name ASC,
    // so the global ascending min is page 1 row 1.
    await gotoFiltered(page, SORT_PREFIX)
    await setPageSize(page, '10')
    await expect(page.locator(ROW)).toHaveCount(10)

    const firstRowName = page.locator(ROW).first().locator(NAME)

    // Default ascending: page 1 row 1 is the GLOBAL min (-01), never a per-page
    // min like -03 (the smallest of the first 10 in insertion order).
    await expect(firstRowName).toHaveText(new RegExp(`${SORT_PREFIX}-01$`), { timeout: 10_000 })

    // Page 2 continues the global ascending sequence (-11 follows -10).
    await page.locator('[data-testid="pagination"]').getByRole('button', { name: /next page/i }).click()
    await expect(page.locator(ROW)).toHaveCount(2)
    await expect(firstRowName).toHaveText(new RegExp(`${SORT_PREFIX}-11$`), { timeout: 10_000 })

    // One Name click flips ascending -> descending: page 1 row 1 is the GLOBAL max (-12).
    await page.locator('[data-testid="pagination"]').getByRole('button', { name: /first page/i }).click()
    // Wait for the page-1 (asc) reload to settle before flipping the sort - else the
    // header click races the in-flight first-page fetch and the flip is dropped.
    await expect(firstRowName).toHaveText(new RegExp(`${SORT_PREFIX}-01$`), { timeout: 10_000 })
    await clickHeader(page, 'Name')
    await expect(firstRowName).toHaveText(new RegExp(`${SORT_PREFIX}-12$`), { timeout: 10_000 })
  })

  test('V-LIB-01-S3: Version sort is semver-ordered, not lexical', async ({ page }) => {
    // A 10.x must sort AFTER a 2.x.
    // Lexically "10.0.0" < "2.0.0", so a page of {1..12}.0.0 sorted lexically is
    // NOT numerically monotonic; a semver sort is.
    await gotoFiltered(page, SORT_PREFIX)
    await setPageSize(page, '10')
    await expect(page.locator(ROW)).toHaveCount(10)

    // Click 1 = ascending. Wait for the semver settle: row 1 is 1.0.0 and row 2
    // is 2.0.0 - a LEXICAL sort would place 10.0.0 in row 2 instead.
    await clickHeader(page, 'Version')
    const versionCells = page.locator(VERSION)
    await expect(versionCells.nth(0)).toHaveText('1.0.0', { timeout: 10_000 })
    await expect(versionCells.nth(1)).toHaveText('2.0.0', { timeout: 10_000 })

    const majors = (await versionCells.allTextContents()).map((v) => Number(v.trim().split('.')[0]))
    // Strict numeric ascending on page 1 ([1..10]) is only possible with a semver
    // sort; lexically the page would be [1,10,11,12,2,...] (not monotonic).
    expect(
      majors.every((m, i) => i === 0 || majors[i - 1] < m),
      `version order was ${majors.join(',')}`,
    ).toBe(true)
  })

  test('V-LIB-01-S4: long description does not blow out the row width', async ({ page }) => {
    // A long unbroken description never widens the table: the shared TruncatedName
    // caps + clips it and surfaces the full text in a hover popover.
    await gotoFiltered(page, LONG_PREFIX)
    await expect(page.locator(ROW)).toHaveCount(1)

    // The table does not scroll horizontally despite the long token.
    const overflow = await page.locator('[data-testid="functions-table"]').evaluate((root) => {
      const scroller = root.querySelector('div.overflow-auto')
      return scroller ? scroller.scrollWidth - scroller.clientWidth : 0
    })
    expect(overflow, 'list table must not overflow horizontally').toBeLessThanOrEqual(1)
    await expect(page.locator('th').filter({ hasText: /^Version$/ })).toBeVisible()
    await expect(page.locator('th').filter({ hasText: /^Updated$/ })).toBeVisible()

    // The description clips (inner text overflows its bounded box).
    const desc = page.locator('[data-testid="function-description"]')
    const clipped = await desc.evaluate((el) => {
      const inner = el.querySelector('span')
      return inner ? inner.scrollWidth - inner.clientWidth > 1 : false
    })
    expect(clipped, 'description should clip with an ellipsis').toBe(true)

    // Hovering reveals the full text in a popover.
    await desc.hover()
    const tip = page.getByRole('tooltip')
    await expect(tip).toBeVisible()
    await expect(tip).toHaveText(LONG_DESC)
  })
})
