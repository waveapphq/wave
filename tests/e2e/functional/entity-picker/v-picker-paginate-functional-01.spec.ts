/**
 * V-PICKER-PAGINATE-FUNCTIONAL-01: EntityPickerModal - cross-page selection
 * persists and Add Selected delivers every picked entity.
 *
 * Fixture: fixtures/shared/v-picker-paginate-functional-01/01-seed.sh
 * Design Decisions: PICKER-1, PICKER-5 (+ the selection-Map contract)
 * Covers: EntityPickerModal pagination + error surfacing
 *
 * Pass Criteria:
 * 1. In the suite test picker, a row selected on page 1 stays selected
 *    while pages 2 and 3 load; "Add Selected (2)" delivers BOTH the page-1
 *    and the page-3 pick; after Save the suite contains exactly those ids.
 * 2. The regression suite picker behaves identically; the added edit-mode
 *    rows carry the picker-cached real metadata (failed status badge, not a
 *    zeroed never_run placeholder); after Save the regression contains both.
 *
 * The picker is scoped to this fixture's entities via the PKR2T / PKR2S
 * search prefixes (search applies to every loaded page), so the spec is
 * independent of whatever sibling functional specs left in the DB.
 */

import { test, expect, type Page, type Locator } from '../../helpers/playwright-fixtures'
import { exec } from '../../helpers/exec'
import { BACKEND_URL } from '../../helpers/config'

const TARGET_SUITE_ID = 'e9100002-0001-0001-0001-000000000001'
const TARGET_REGRESSION_ID = 'e9100005-0001-0001-0001-000000000001'

const pad12 = (n: number): string => String(n).padStart(12, '0')
const CAND_TEST_ID = (n: number): string => `e9100001-0001-0001-0001-${pad12(n)}`
const CAND_SUITE_ID = (n: number): string => `e9100003-0001-0001-0001-${pad12(n)}`

// Seeded names are "PKR2T Cand 007" / "PKR2S Suite 042"; the trailing number
// maps a picker row back to its fixed fixture UUID.
function entityFromRowText(
  rowText: string,
  prefix: 'PKR2T Cand' | 'PKR2S Suite',
  idOf: (n: number) => string,
): { name: string; id: string } {
  const match = new RegExp(`${prefix} (\\d{3})`).exec(rowText)
  if (!match) throw new Error(`Picker row is not a ${prefix} fixture row: ${rowText}`)
  return { name: `${prefix} ${match[1]}`, id: idOf(Number(match[1])) }
}

async function scrollListToBottom(page: Page, listTestId: string): Promise<void> {
  await page.locator(`[data-testid="${listTestId}"]`).evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
}

/** Type the namespace prefix into the picker search and await the filtered reload. */
async function applyPickerSearch(
  page: Page,
  modal: Locator,
  searchTestId: string,
  endpoint: '/tests' | '/suites',
  prefix: string,
): Promise<void> {
  const searchApplied = page.waitForResponse(
    (resp) => resp.url().includes(`${endpoint}?`) && resp.url().includes(`search=${prefix}`),
  )
  await modal.locator(`[data-testid="${searchTestId}"] input`).fill(prefix)
  await searchApplied
}

test.describe('V-PICKER-PAGINATE-FUNCTIONAL-01: cross-page picker selection', () => {
  test.beforeAll(() => {
    exec('./tests/e2e/fixtures/shared/v-picker-paginate-functional-01/01-seed.sh')
  })

  test.afterAll(() => {
    exec('./tests/e2e/fixtures/shared/v-picker-paginate-functional-01/02-cleanup.sh')
  })

  test('suite test picker - selection survives page loads and Add persists both tests', async ({
    page,
    request,
  }) => {
    await page.goto(`/suites/${TARGET_SUITE_ID}`)
    await expect(page.locator('[data-testid="suite-detail-page"]')).toBeVisible({
      timeout: 15000,
    })
    await page.locator('[data-testid="edit-tests-btn"]').click()
    await page.locator('[data-testid="add-tests-button"]').click()
    const modal = page.locator('[data-testid="test-picker-modal"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    await applyPickerSearch(page, modal, 'test-picker-search', '/tests', 'PKR2T')
    const rows = modal.locator('[data-testid="test-picker-test-row"]')
    const fixtureRows = rows.filter({ hasText: 'PKR2T' })
    await expect(fixtureRows).toHaveCount(25, { timeout: 10000 })

    // Select a page-1 row BEFORE any further page loads
    const first = entityFromRowText(
      await fixtureRows.first().innerText(),
      'PKR2T Cand',
      CAND_TEST_ID,
    )
    await fixtureRows.first().click()
    const addBtn = modal.locator('[data-testid="test-picker-add-btn"]')
    await expect(addBtn).toHaveText('Add Selected (1)')

    // Load pages 2 and 3 (search stays applied on every page)
    await scrollListToBottom(page, 'test-picker-list')
    await expect(fixtureRows).toHaveCount(50, { timeout: 10000 })
    await scrollListToBottom(page, 'test-picker-list')
    await expect(fixtureRows).toHaveCount(60, { timeout: 10000 })

    // The page-1 selection survived; now pick a page-3 row (appended last)
    const last = entityFromRowText(
      await fixtureRows.nth(59).innerText(),
      'PKR2T Cand',
      CAND_TEST_ID,
    )
    await fixtureRows.nth(59).click()
    await expect(addBtn).toHaveText('Add Selected (2)')
    await addBtn.click()
    await expect(modal).toBeHidden({ timeout: 5000 })

    // Both picks land in the edit-mode table
    await expect(page.getByText(first.name, { exact: true })).toBeVisible()
    await expect(page.getByText(last.name, { exact: true })).toBeVisible()

    // Save and verify the persisted suite holds exactly the two picked ids
    await page.locator('[data-testid="save-tests-btn"]').click()
    await expect(page.locator('[data-testid="edit-tests-btn"]')).toBeVisible({ timeout: 15000 })

    const resp = await request.get(`${BACKEND_URL}/suites/${TARGET_SUITE_ID}`)
    expect(resp.ok(), `Get suite failed: ${resp.status()}`).toBeTruthy()
    const body = await resp.json()
    const savedTests: string[] = body.data.tests ?? []
    expect(savedTests).toHaveLength(2)
    expect(savedTests).toContain(first.id)
    expect(savedTests).toContain(last.id)
  })

  test('regression suite picker - cross-page add carries cached real metadata and persists', async ({
    page,
    request,
  }) => {
    await page.goto(`/regressions/${TARGET_REGRESSION_ID}`)
    await expect(page.locator('[data-testid="regression-detail-page"]')).toBeVisible({
      timeout: 15000,
    })
    await expect(page.locator('[data-testid="regression-detail-loading"]')).toHaveCount(0)
    await page.locator('[data-testid="edit-suites-btn"]').click()
    await page.locator('[data-testid="add-suites-btn"]').click()
    const modal = page.locator('[data-testid="suite-picker-modal"]')
    await expect(modal).toBeVisible({ timeout: 10000 })

    await applyPickerSearch(page, modal, 'suite-picker-search', '/suites', 'PKR2S')
    const rows = modal.locator('[data-testid="suite-picker-suite-row"]')
    const fixtureRows = rows.filter({ hasText: 'PKR2S' })
    await expect(fixtureRows).toHaveCount(25, { timeout: 10000 })

    const first = entityFromRowText(
      await fixtureRows.first().innerText(),
      'PKR2S Suite',
      CAND_SUITE_ID,
    )
    await fixtureRows.first().click()
    const addBtn = modal.locator('[data-testid="suite-picker-add-btn"]')
    await expect(addBtn).toHaveText('Add Selected (1)')

    await scrollListToBottom(page, 'suite-picker-list')
    await expect(fixtureRows).toHaveCount(50, { timeout: 10000 })
    await scrollListToBottom(page, 'suite-picker-list')
    await expect(fixtureRows).toHaveCount(60, { timeout: 10000 })

    const last = entityFromRowText(
      await fixtureRows.nth(59).innerText(),
      'PKR2S Suite',
      CAND_SUITE_ID,
    )
    await fixtureRows.nth(59).click()
    await expect(addBtn).toHaveText('Add Selected (2)')
    await addBtn.click()
    await expect(modal).toBeHidden({ timeout: 5000 })

    // The added edit-mode rows show the picker-cached REAL metadata: every
    // fixture suite has a failed execution, so the badge must be "failed",
    // never the zeroed never_run placeholder.
    const table = page.locator('[data-testid="regression-suites-table"]')
    for (const entity of [first, last]) {
      const row = table.locator('tr').filter({ hasText: entity.name })
      await expect(row).toHaveCount(1)
      await expect(row.locator('[data-testid="status-badge-failed"]')).toBeVisible()
      await expect(row.locator('[data-testid="status-badge-never-run"]')).toHaveCount(0)
    }

    // Save and verify the persisted regression holds exactly the two picks
    await page.locator('[data-testid="save-suites-btn"]').click()
    await expect(page.locator('[data-testid="edit-suites-btn"]')).toBeVisible({ timeout: 15000 })

    const resp = await request.get(`${BACKEND_URL}/regressions/${TARGET_REGRESSION_ID}`)
    expect(resp.ok(), `Get regression failed: ${resp.status()}`).toBeTruthy()
    const body = await resp.json()
    const savedSuites: string[] = body.data.suites ?? []
    expect(savedSuites).toHaveLength(2)
    expect(savedSuites).toContain(first.id)
    expect(savedSuites).toContain(last.id)
  })
})
